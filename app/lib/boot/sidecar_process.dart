import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:meta/meta.dart';
import 'package:rudra/boot/handshake.dart';
import 'package:rudra/core/bounded.dart';
import 'package:rudra/core/limits.dart';

/// How the sidecar is currently doing.
enum SidecarPhase { idle, starting, ready, failed, stopped }

@immutable
class SidecarState {
  const SidecarState({
    required this.phase,
    this.handshake,
    this.message,
    this.logTail = const <String>[],
  });

  const SidecarState.idle() : this._(phase: SidecarPhase.idle);

  const SidecarState._({
    required this.phase,
    this.handshake,
    this.message,
    this.logTail = const <String>[],
  });

  final SidecarPhase phase;

  /// Set once [phase] is [SidecarPhase.ready].
  final Handshake? handshake;

  /// A human-readable note: what it is doing, or why it failed.
  final String? message;

  /// The last few stderr lines, for the boot-failure surface. §7 — no dead
  /// ends: a failure shows something actionable instead of a spinner forever.
  final List<String> logTail;

  bool get isReady => phase == SidecarPhase.ready && handshake != null;

  SidecarState copyWith({
    SidecarPhase? phase,
    Handshake? handshake,
    String? message,
    List<String>? logTail,
  }) => SidecarState(
    phase: phase ?? this.phase,
    handshake: handshake ?? this.handshake,
    message: message ?? this.message,
    logTail: logTail ?? this.logTail,
  );
}

/// Spawns and supervises the backend sidecar.
///
/// PLAN.MD §8: we spawn it, read `{port, token}` from its first stdout line,
/// and it dies with us. `RUDRA_PARENT_PID` is passed so the sidecar can watch
/// this process even when launched through a shim.
class SidecarProcess {
  SidecarProcess({this.bootTimeout = const Duration(seconds: 20)});

  final Duration bootTimeout;

  Process? _process;
  StreamSubscription<String>? _stdout;
  StreamSubscription<String>? _stderr;
  final List<String> _logTail = <String>[];
  bool _handshakeSeen = false;

  Handshake? get handshake => _handshake;
  Handshake? _handshake;

  List<String> get logTail => List<String>.unmodifiable(_logTail);

  /// Start the sidecar and wait for its handshake.
  ///
  /// Throws [SidecarLaunchException] with a message worth showing to a person.
  Future<Handshake> start() async {
    if (_process != null) {
      throw StateError('Sidecar already started.');
    }

    final _Launch launch = _resolveLaunch();

    final Process process;
    try {
      process = await Process.start(
        launch.executable,
        launch.arguments,
        environment: <String, String>{
          'RUDRA_PARENT_PID': '$pid',
          if (Platform.environment.containsKey('RUDRA_HOME'))
            'RUDRA_HOME': Platform.environment['RUDRA_HOME']!,
          'RUDRA_LOG': const bool.fromEnvironment('dart.vm.product')
              ? 'info'
              : 'debug',
        },
        includeParentEnvironment: true,
        workingDirectory: launch.workingDirectory,
      );
    } on ProcessException catch (e) {
      throw SidecarLaunchException(
        'Could not start the backend.\n'
        'Tried: ${launch.executable} ${launch.arguments.join(' ')}\n'
        '${e.message}',
      );
    }
    _process = process;

    final Completer<Handshake> ready = Completer<Handshake>();

    // stdout: line one is the handshake. Anything after it violates
    // INVARIANT 18, so we keep it only as a diagnostic.
    // stdout carries the handshake, which is longer than a log line, so this
    // pipe gets the handshake ceiling rather than the log one.
    _stdout =
        boundedLines(
          process.stdout.transform(utf8.decoder),
          maxLineChars: Limits.maxHandshakeLineChars,
        ).listen((String line) {
          if (_handshakeSeen) {
            _appendLog('[stdout after handshake] $line');
            return;
          }
          final Handshake? parsed = Handshake.tryParse(line);
          if (parsed == null) {
            _appendLog('[stdout] $line');
            return;
          }
          _handshakeSeen = true;
          _handshake = parsed;
          if (!ready.isCompleted) ready.complete(parsed);
        });

    // stderr is the app log.
    _stderr = boundedLines(
      process.stderr.transform(utf8.decoder),
    ).listen(_appendLog);

    // An early exit is a boot failure, not a shutdown.
    unawaited(
      process.exitCode.then((int code) {
        if (!ready.isCompleted) {
          ready.completeError(
            SidecarLaunchException(
              'The backend exited with code $code before it was ready.\n'
              '${_logTail.isEmpty ? '(no output)' : _logTail.takeLast(8).join('\n')}',
            ),
          );
        }
      }),
    );

    try {
      final Handshake result = await ready.future.timeout(bootTimeout);
      if (!result.isProtocolCompatible) {
        await stop();
        throw SidecarLaunchException(
          'Backend protocol ${result.protocol} does not match this app '
          '(expects ${Handshake.expectedProtocol}). Update one of them.',
        );
      }
      return result;
    } on TimeoutException {
      await stop();
      throw SidecarLaunchException(
        'The backend did not report ready within '
        '${bootTimeout.inSeconds}s.\n'
        '${_logTail.isEmpty ? '(no output)' : _logTail.takeLast(8).join('\n')}',
      );
    }
  }

  void _appendLog(String line) {
    if (line.trim().isEmpty) return;
    // The line is already bounded by `_boundedLines`, but the retained copy is
    // bounded again and independently: `logTail` is held for the lifetime of a
    // failed boot and rendered into a widget.
    _logTail.add(
      line.length > Limits.maxLogLineChars
          ? '${line.substring(0, Limits.maxLogLineChars)}… (truncated)'
          : line,
    );
    if (_logTail.length > Limits.maxLogLines) {
      _logTail.removeRange(0, _logTail.length - Limits.maxLogLines);
    }
  }

  /// Stop the sidecar.
  ///
  /// Closing stdin is the polite signal — the sidecar watches for EOF. SIGTERM
  /// follows, and SIGKILL after a grace period, because a hung backend must not
  /// prevent the app from quitting.
  Future<void> stop() async {
    final Process? process = _process;
    _process = null;
    if (process == null) return;

    try {
      await process.stdin.close();
    } on Object {
      // Already gone.
    }

    final Future<int> exited = process.exitCode;
    process.kill(ProcessSignal.sigterm);

    try {
      await exited.timeout(const Duration(seconds: 3));
    } on TimeoutException {
      process.kill(ProcessSignal.sigkill);
    }

    await _stdout?.cancel();
    await _stderr?.cancel();
    _stdout = null;
    _stderr = null;
  }

  /// Decide how to launch.
  ///
  /// Release builds run the compiled sidecar binary next to the app. In
  /// development there is no binary, so we run the TypeScript entrypoint with
  /// `bun` from the repo. `RUDRA_SIDECAR` overrides both.
  _Launch _resolveLaunch() {
    final String? override = Platform.environment['RUDRA_SIDECAR'];
    if (override != null && override.isNotEmpty) {
      return _Launch(executable: override, arguments: const <String>[]);
    }

    final String exeName = Platform.isWindows
        ? 'rudra-sidecar.exe'
        : 'rudra-sidecar';
    final Directory appDir = File(Platform.resolvedExecutable).parent;
    final File bundled = File(
      '${appDir.path}${Platform.pathSeparator}$exeName',
    );
    if (bundled.existsSync()) {
      return _Launch(executable: bundled.path, arguments: const <String>[]);
    }

    // Development: find the repo root by walking up for server/src/index.ts.
    final Directory? repo = _findRepoRoot(Directory.current);
    if (repo != null) {
      final String entry =
          '${repo.path}${Platform.pathSeparator}server'
          '${Platform.pathSeparator}src${Platform.pathSeparator}index.ts';
      return _Launch(
        executable: Platform.isWindows ? 'bun.exe' : 'bun',
        arguments: <String>[entry],
        workingDirectory: repo.path,
      );
    }

    throw SidecarLaunchException(
      'No backend found.\n'
      'Looked for "$exeName" beside the app, and for server/src/index.ts in a '
      'parent directory.\n'
      'Set RUDRA_SIDECAR to the backend executable to override.',
    );
  }

  static Directory? _findRepoRoot(Directory from) {
    Directory current = from.absolute;
    for (int depth = 0; depth < 8; depth++) {
      final File marker = File(
        '${current.path}${Platform.pathSeparator}server'
        '${Platform.pathSeparator}src${Platform.pathSeparator}index.ts',
      );
      if (marker.existsSync()) return current;
      final Directory parent = current.parent;
      if (parent.path == current.path) break;
      current = parent;
    }
    return null;
  }
}

@immutable
class _Launch {
  const _Launch({
    required this.executable,
    required this.arguments,
    this.workingDirectory,
  });

  final String executable;
  final List<String> arguments;
  final String? workingDirectory;
}

/// A boot failure with a message meant for a person, not a stack trace.
class SidecarLaunchException implements Exception {
  const SidecarLaunchException(this.message);

  final String message;

  @override
  String toString() => message;
}

extension _TakeLast<T> on List<T> {
  Iterable<T> takeLast(int n) => skip(length > n ? length - n : 0);
}

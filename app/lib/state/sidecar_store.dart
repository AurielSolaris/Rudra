import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rudra/api/client.dart';
import 'package:rudra/boot/handshake.dart';
import 'package:rudra/boot/sidecar_process.dart';

// The UI reads sidecar phase/state through this store, so re-export the types
// rather than making every widget import the process module too.
export 'package:rudra/boot/sidecar_process.dart'
    show SidecarPhase, SidecarState;

/// Owns the sidecar's lifecycle.
///
/// One provider per concern (docs/ui-guidelines.md §12). Kept alive for the
/// whole app session: this is the one place where `autoDispose` would be wrong,
/// since disposing it would kill the backend.
final NotifierProvider<SidecarStore, SidecarState> sidecarProvider =
    NotifierProvider<SidecarStore, SidecarState>(SidecarStore.new);

class SidecarStore extends Notifier<SidecarState> {
  SidecarProcess? _process;

  @override
  SidecarState build() {
    ref.onDispose(() {
      // Fire and forget: the app is going away, and the sidecar also watches
      // for our stdin to close, so it cannot be orphaned by a slow teardown.
      unawaited(_process?.stop());
    });
    return const SidecarState.idle();
  }

  /// Start the backend and confirm it is really serving.
  Future<void> boot() async {
    if (state.phase == SidecarPhase.starting || state.isReady) return;

    state = const SidecarState(
      phase: SidecarPhase.starting,
      message: 'Starting the backend…',
    );

    final SidecarProcess process = SidecarProcess();
    _process = process;

    try {
      final Handshake handshake = await process.start();

      state = SidecarState(
        phase: SidecarPhase.starting,
        handshake: handshake,
        message: 'Checking health…',
        logTail: process.logTail,
      );

      // Spawned is not the same as serving, so confirm before showing the UI.
      final RudraClient client = RudraClient(handshake: handshake);
      try {
        await client.health();
      } finally {
        client.close();
      }

      state = SidecarState(
        phase: SidecarPhase.ready,
        handshake: handshake,
        message: 'Ready',
        logTail: process.logTail,
      );
    } on SidecarLaunchException catch (e) {
      state = SidecarState(
        phase: SidecarPhase.failed,
        message: e.message,
        logTail: process.logTail,
      );
    } on ApiException catch (e) {
      state = SidecarState(
        phase: SidecarPhase.failed,
        message:
            'The backend started but refused a request: ${e.error.message}',
        logTail: process.logTail,
      );
    } on Object catch (e) {
      state = SidecarState(
        phase: SidecarPhase.failed,
        message: 'Unexpected failure while starting the backend: $e',
        logTail: process.logTail,
      );
    }
  }

  /// Retry after a failure. §7 — no dead ends.
  Future<void> retry() async {
    await _process?.stop();
    _process = null;
    state = const SidecarState.idle();
    await boot();
  }

  Future<void> shutdown() async {
    await _process?.stop();
    _process = null;
    state = const SidecarState(phase: SidecarPhase.stopped);
  }
}

/// The API client, available only once the sidecar is ready.
///
/// Widgets never build requests themselves; they read this (§12).
final Provider<RudraClient?> clientProvider = Provider<RudraClient?>((Ref ref) {
  final SidecarState sidecar = ref.watch(sidecarProvider);
  final Handshake? handshake = sidecar.handshake;
  if (!sidecar.isReady || handshake == null) return null;

  final RudraClient client = RudraClient(handshake: handshake);
  ref.onDispose(client.close);
  return client;
});

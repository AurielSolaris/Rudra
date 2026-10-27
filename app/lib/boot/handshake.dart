import 'dart:convert';

import 'package:meta/meta.dart';
import 'package:rudra/core/limits.dart';

/// The sidecar's handshake line.
///
/// PLAN.MD §8 — the sidecar prints exactly one line of JSON to stdout before it
/// serves, carrying the OS-assigned port and the session token. This is the only
/// thing it ever writes to stdout; everything else goes to stderr
/// (INVARIANT 18), which is what makes parsing line one safe.
@immutable
class Handshake {
  const Handshake({
    required this.protocol,
    required this.version,
    required this.port,
    required this.token,
    required this.pid,
  });

  /// Parse one stdout line.
  ///
  /// Returns null rather than throwing: during boot, a malformed line is an
  /// expected failure mode to report in the UI, not an exception to crash on.
  static Handshake? tryParse(String line) {
    // Bounded before anything is decoded. The real line is ~200 characters;
    // past the ceiling the goal is to stop reading, not to parse harder.
    if (line.length > Limits.maxHandshakeLineChars) return null;

    final String trimmed = line.trim();
    if (trimmed.isEmpty || !trimmed.startsWith('{')) return null;

    final Object? decoded;
    try {
      decoded = jsonDecode(trimmed);
    } on FormatException {
      return null;
    }
    if (decoded is! Map<String, Object?>) return null;

    if (decoded['rudra'] != 'handshake') return null;

    final Object? protocol = decoded['protocol'];
    final Object? version = decoded['version'];
    final Object? port = decoded['port'];
    final Object? token = decoded['token'];
    final Object? pid = decoded['pid'];

    if (protocol is! int || version is! String) return null;
    if (port is! int || port <= 0 || port > 65535) return null;
    if (token is! String || token.length != 64) return null;
    if (pid is! int) return null;

    return Handshake(
      protocol: protocol,
      version: version,
      port: port,
      token: token,
      pid: pid,
    );
  }

  /// Bumped when the handshake or route shapes change.
  final int protocol;
  final String version;
  final int port;

  /// Required on every request. Never logged, never shown in the UI.
  final String token;
  final int pid;

  /// What this build of the app can talk to.
  static const int expectedProtocol = 1;

  bool get isProtocolCompatible => protocol == expectedProtocol;

  Uri resolve(String path) =>
      Uri.parse('http://127.0.0.1:$port').replace(path: path);

  /// Deliberately omits the token, so a stray `print` cannot leak it.
  @override
  String toString() =>
      'Handshake(protocol: $protocol, version: $version, port: $port, pid: $pid)';
}

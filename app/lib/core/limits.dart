/// Every numeric bound on the Dart side, in one place.
///
/// This mirrors `packages/shared/src/limits.ts`. The duplication is deliberate
/// — a generated file would have to be regenerated to read a constant, and
/// these are read on the hot path — and it is kept honest by
/// `app/test/limits_test.dart`, which parses the TypeScript source and fails
/// the build if any value here disagrees with it.
///
/// Mirrors: packages/shared/src/limits.ts
abstract final class Limits {
  /// Largest single SSE frame to accept, in bytes.
  ///
  /// Enforced while *scanning for the boundary*, not after finding it: the
  /// whole point is to stop buffering a peer that never sends one.
  static const int maxSseFrameBytes = 1024 * 1024;

  /// Largest accumulated assistant message, in characters.
  ///
  /// On reaching it the message completes with `StreamEndReason.length`, which
  /// the UI already renders as a designed partial state.
  static const int maxMessageChars = 256 * 1024;

  /// Largest number of messages resident in a transcript.
  static const int maxTranscriptMessages = 2000;

  /// Largest error-response body to read before giving up, in bytes.
  static const int maxErrorBodyBytes = 64 * 1024;

  /// Largest handshake line, in characters.
  static const int maxHandshakeLineChars = 4096;

  /// Largest single retained log line, in characters.
  static const int maxLogLineChars = 2000;

  /// Number of sidecar log lines retained.
  static const int maxLogLines = 40;
}

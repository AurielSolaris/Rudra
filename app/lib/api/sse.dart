import 'dart:convert';

import 'package:rudra/api/generated/models.dart';
import 'package:rudra/core/limits.dart';

/// Parse an SSE byte stream into [StreamEvent]s.
///
/// The wire format is the server's `sse.ts`: an `event:` line, a `data:` line
/// holding single-line JSON, terminated by a blank line. Because the JSON is
/// always on one line, multi-line `data:` reassembly never arises.
///
/// Cancelling the returned stream closes the HTTP response, which the server
/// sees as a client disconnect — that is how interruption reaches the agent loop
/// (PLAN.MD §7).
///
/// ## Why this function is defensive
///
/// It reads a socket. Everything it is handed is untrusted input, *including*
/// our own sidecar — a wedged, downgraded, or replaced backend is precisely the
/// case a bound exists for. So:
///
/// * The carry buffer is capped at [Limits.maxSseFrameBytes]. A peer that never
///   sends a frame boundary cannot grow it without limit.
/// * The boundary scan resumes near the end of the previous carry instead of
///   restarting at zero, so a large legitimate frame costs O(n), not O(n²).
/// * A malformed frame yields a terminal [StreamError] rather than throwing.
///   The caller already renders that as a designed state; an exception escaping
///   an `async*` body would surface as an unhandled stream error instead.
///
/// This function never throws. Every failure leaves by the same door as a
/// server-sent error, which is the only reason the UI needs one error path.
Stream<StreamEvent> parseSseEvents(Stream<List<int>> bytes) async* {
  // A plain String, not a StringBuffer: complete frames are drained on every
  // chunk, so the carry holds at most one partial frame. Re-materialising a
  // StringBuffer each chunk copied the whole accumulation instead.
  String carry = '';

  await for (final String chunk in bytes.transform(utf8.decoder)) {
    // A boundary is at most 4 characters, so only the tail of the previous
    // carry can take part in a boundary that straddles this chunk.
    int scanFrom = carry.length - 3;
    if (scanFrom < 0) scanFrom = 0;

    carry += chunk;

    _Boundary boundary = _nextBoundary(carry, scanFrom);
    while (boundary.found) {
      final String frame = carry.substring(0, boundary.index);
      carry = carry.substring(boundary.index + boundary.length);

      final StreamEvent? event = _decodeFrame(frame);
      if (event != null) yield event;

      boundary = _nextBoundary(carry, 0);
    }

    // The cap is in bytes and this count is in characters. For UTF-8 a
    // character is never fewer bytes than one, so `chars > cap` implies
    // `bytes > cap`: this can only reject a frame that genuinely exceeds the
    // limit, never one that merely looks large after decoding.
    if (carry.length > Limits.maxSseFrameBytes) {
      yield const StreamError(
        type: 'error',
        error: ApiError(
          code: ErrorCode.internal,
          message:
              'The backend sent a malformed response stream '
              '(no frame boundary within ${Limits.maxSseFrameBytes} bytes).',
        ),
      );
      return;
    }
  }

  // A final frame may arrive without its trailing blank line, because the
  // server can close the connection immediately after the terminal event.
  final StreamEvent? last = _decodeFrame(carry);
  if (last != null) yield last;
}

/// Decode one frame.
///
/// Returns null when the frame carries no usable `data:` line — a comment or
/// keep-alive. Returns a [StreamError] when the payload is present but not
/// something the contract describes: that is a real disagreement between app
/// and backend, and it terminates the stream with a message that says so.
StreamEvent? _decodeFrame(String frame) {
  if (frame.trim().isEmpty) return null;

  for (final String line in frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    final String payload = line.substring(5).trim();
    if (payload.isEmpty) continue;

    final Object? decoded;
    try {
      decoded = jsonDecode(payload);
    } on FormatException {
      return _malformed('its JSON could not be parsed');
    }
    if (decoded is! Map<String, dynamic>) {
      return _malformed('a stream event was not a JSON object');
    }

    try {
      return StreamEvent.fromJson(decoded);
    } on WireTypeError catch (e) {
      // A field of the wrong type, or an event type this build does not know.
      // Surfaced, not swallowed: silently skipping it would present a truncated
      // stream as a complete one.
      return _malformed(e.message);
    }
  }
  return null;
}

StreamError _malformed(String detail) => StreamError(
  type: 'error',
  error: ApiError(
    code: ErrorCode.internal,
    message: 'The backend sent an event this app could not read: $detail.',
  ),
);

/// Where the next frame ends. SSE permits LF or CRLF, so both are handled.
class _Boundary {
  const _Boundary(this.index, this.length);
  const _Boundary.none() : index = -1, length = 0;

  final int index;
  final int length;

  bool get found => index != -1;
}

_Boundary _nextBoundary(String s, int from) {
  final int lf = s.indexOf('\n\n', from);
  final int crlf = s.indexOf('\r\n\r\n', from);

  if (lf == -1 && crlf == -1) return const _Boundary.none();
  if (crlf != -1 && (lf == -1 || crlf < lf)) return _Boundary(crlf, 4);
  return _Boundary(lf, 2);
}

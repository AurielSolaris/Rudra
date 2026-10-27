import 'dart:convert';

import 'package:rudra/core/limits.dart';

/// Readers that stop.
///
/// Both functions here replace a convenient standard-library call that reads
/// until its input decides to stop. On a socket or a pipe that decision does
/// not belong to us, so these take a ceiling instead. They live in one file,
/// public rather than private to their call sites, so the bound is testable
/// directly rather than only through the thing that uses it.

/// Split a character stream into lines, with a ceiling on line length.
///
/// `LineSplitter` is unbounded: a child process that writes a great deal of
/// output and no newline — a progress bar, a stack trace from a runaway loop, a
/// binary blob on the wrong pipe — makes it buffer until the app dies. The
/// sidecar is a subprocess whose output we do not control, so that is an input
/// to bound, not a case to assume away.
///
/// At the ceiling the carry is emitted as its own line and the remainder
/// continues as the next. Nothing is dropped silently: a long line becomes
/// several, which for a log tail is the right trade.
Stream<String> boundedLines(
  Stream<String> chars, {
  int maxLineChars = Limits.maxLogLineChars,
}) async* {
  assert(maxLineChars > 0, 'maxLineChars must be positive');
  String carry = '';

  await for (final String chunk in chars) {
    carry += chunk;

    int start = 0;
    for (int i = 0; i < carry.length; i++) {
      if (carry.codeUnitAt(i) != 0x0A) continue;
      // Drop a preceding CR so CRLF output does not leave a stray character.
      int end = i;
      if (end > start && carry.codeUnitAt(end - 1) == 0x0D) end -= 1;
      yield carry.substring(start, end);
      start = i + 1;
    }
    if (start != 0) carry = carry.substring(start);

    // The carry is capped before the next chunk, which also keeps the scan
    // above O(maxLineChars) per chunk rather than O(total) when no newline
    // ever arrives.
    while (carry.length > maxLineChars) {
      yield carry.substring(0, maxLineChars);
      carry = carry.substring(maxLineChars);
    }
  }

  if (carry.isNotEmpty) yield carry;
}

/// Read a byte stream into a string, stopping at [maxBytes].
///
/// `bytesToString()` reads to completion. On a success path that is fine,
/// because the body is the bounded JSON we asked for. On an *error* path the
/// body is whatever the peer chose to send, and a client that buffers all of it
/// to build an exception message has turned a failure into a crash.
Future<String> readCapped(
  Stream<List<int>> body, {
  int maxBytes = Limits.maxErrorBodyBytes,
}) async {
  final List<int> bytes = <int>[];
  await for (final List<int> chunk in body) {
    final int room = maxBytes - bytes.length;
    if (room <= 0) break;
    bytes.addAll(chunk.length <= room ? chunk : chunk.take(room));
    if (bytes.length >= maxBytes) break;
  }
  // A truncated body can end mid-sequence, so decoding is lenient: the result
  // is only ever used to build a message for a person.
  return utf8.decode(bytes, allowMalformed: true);
}

import 'package:flutter/foundation.dart';
import 'package:rudra/core/limits.dart';

/// A single in-flight assistant message.
///
/// **INVARIANT 11 (MAP.txt) — the whole reason this class exists.**
///
/// A streaming token delta must never travel through the Riverpod provider
/// graph. If it did, every token would invalidate the provider that the message
/// list watches, and Flutter would rebuild the entire transcript 40+ times a
/// second. At 5,000 messages that is visible, permanent jank.
///
/// So: the provider learns about a message twice — when it starts, and when it
/// finishes. In between, deltas land here, and exactly one
/// [ValueListenableBuilder] inside that one bubble repaints.
///
/// See docs/ui-guidelines.md §11 and §12.
class StreamingMessage extends ChangeNotifier
    implements ValueListenable<String> {
  StreamingMessage({required this.messageId});

  final String messageId;

  final StringBuffer _buffer = StringBuffer();
  String _cached = '';
  bool _dirty = false;

  /// The text accumulated so far.
  @override
  String get value {
    if (_dirty) {
      _cached = _buffer.toString();
      _dirty = false;
    }
    return _cached;
  }

  int get length => _buffer.length;

  bool get isEmpty => _buffer.isEmpty;

  /// True once a terminal event has arrived.
  bool get isComplete => _completion != null;

  /// How the stream ended, or null while it is still running.
  StreamCompletion? get completion => _completion;
  StreamCompletion? _completion;

  /// Append a delta. The single hottest path in the app.
  ///
  /// Bounded at [Limits.maxMessageChars]. A provider that never emits a
  /// terminal event is a real failure mode — a broken stop sequence will do it
  /// — and an unbounded buffer turns that into an out-of-memory crash. At the
  /// ceiling the message completes with [StreamEndReason.length], which is
  /// already a designed state the UI renders, so the cap degrades into an
  /// outcome rather than an error.
  ///
  /// Appending after completion is ignored: the terminal event is
  /// authoritative, so a delta that arrives late cannot extend a settled
  /// message.
  void append(String text) {
    if (text.isEmpty || _completion != null) return;

    final int remaining = Limits.maxMessageChars - _buffer.length;
    if (remaining <= 0) {
      complete(const StreamCompletion.length());
      return;
    }

    if (text.length <= remaining) {
      _buffer.write(text);
      _dirty = true;
      notifyListeners();
      return;
    }

    // Truncating at a UTF-16 code-unit boundary can split a surrogate pair and
    // leave an unpaired half, which renders as a replacement character. Back
    // off by one unit when the cut would land inside a pair.
    int cut = remaining;
    if (cut > 0) {
      final int unit = text.codeUnitAt(cut - 1);
      final bool isHighSurrogate = unit >= 0xD800 && unit <= 0xDBFF;
      if (isHighSurrogate) cut -= 1;
    }
    if (cut > 0) {
      _buffer.write(text.substring(0, cut));
      _dirty = true;
    }
    // Set directly rather than through `complete`, so the truncated text and
    // the terminal reason reach listeners in one notification.
    _completion = const StreamCompletion.length();
    notifyListeners();
  }

  /// Mark the stream finished. Safe to call more than once; the first wins,
  /// because the terminal event is authoritative and a late cancel must not
  /// overwrite it.
  void complete(StreamCompletion completion) {
    if (_completion != null) return;
    _completion = completion;
    notifyListeners();
  }
}

/// Why a stream ended.
///
/// PLAN.MD §7: a partial message is never presented as a complete one, so the
/// reason is carried explicitly rather than inferred from the absence of more
/// text.
@immutable
class StreamCompletion {
  const StreamCompletion.complete()
    : reason = StreamEndReason.complete,
      error = null;
  const StreamCompletion.interrupted()
    : reason = StreamEndReason.interrupted,
      error = null;
  const StreamCompletion.length()
    : reason = StreamEndReason.length,
      error = null;
  const StreamCompletion.failed(String this.error)
    : reason = StreamEndReason.failed;

  final StreamEndReason reason;

  /// Set only when [reason] is [StreamEndReason.failed].
  final String? error;

  bool get isPartial => reason != StreamEndReason.complete;
}

enum StreamEndReason {
  /// The model finished on its own.
  complete,

  /// The user interrupted it.
  interrupted,

  /// A token or length limit cut it off.
  length,

  /// It failed. Whatever arrived before the failure stays displayed.
  failed,
}

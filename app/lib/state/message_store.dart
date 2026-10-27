import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rudra/api/client.dart';
import 'package:rudra/api/generated/models.dart';
import 'package:rudra/core/limits.dart';
import 'package:rudra/state/sidecar_store.dart';
import 'package:rudra/ui/chat/message_notifier.dart';

/// Who said it.
enum Author { user, assistant }

/// One message in the transcript.
///
/// An assistant message that is still streaming carries a [streaming] notifier
/// and an empty [text]; when the stream ends, the text is settled onto the
/// record and the notifier is released. The provider is therefore notified
/// twice per message, not once per token (INVARIANT 11).
@immutable
class Message {
  const Message({
    required this.id,
    required this.author,
    required this.text,
    required this.createdAt,
    this.streaming,
    this.completion,
  });

  final String id;
  final Author author;
  final String text;
  final DateTime createdAt;

  /// Non-null only while this message is being streamed.
  final StreamingMessage? streaming;

  /// How the stream ended. Null for user messages and in-flight ones.
  final StreamCompletion? completion;

  bool get isStreaming => streaming != null;

  Message settled(String finalText, StreamCompletion completion) => Message(
    id: id,
    author: author,
    text: finalText,
    createdAt: createdAt,
    completion: completion,
  );
}

/// The transcript.
///
/// Phase 0 keeps messages in memory. Phase 1 puts them in `main.db` with the
/// autosave semantics in PLAN.MD §7 — the shape here is already what that
/// needs, so persistence slots in behind it.
final NotifierProvider<MessageStore, List<Message>> messagesProvider =
    NotifierProvider<MessageStore, List<Message>>(MessageStore.new);

class MessageStore extends Notifier<List<Message>> {
  StreamSubscription<StreamEvent>? _active;
  StreamingMessage? _activeNotifier;

  @override
  List<Message> build() {
    ref.onDispose(() {
      unawaited(_active?.cancel());
      _activeNotifier?.dispose();
    });
    return const <Message>[];
  }

  /// True while a response is streaming. The composer swaps Send for Stop.
  bool get isStreaming => _active != null;

  /// How many messages have been dropped off the front to honour the cap.
  ///
  /// Exposed rather than hidden: the transcript having been trimmed is a fact
  /// about what the user is looking at, and §7 says every state is designed.
  int get droppedCount => _dropped;
  int _dropped = 0;

  /// Append to the transcript, enforcing [Limits.maxTranscriptMessages].
  ///
  /// Phase 0 holds the transcript in memory, so this is a hard RAM bound: with
  /// the per-message cap it puts a ceiling on a session's worst case. Phase 1
  /// moves the backing store to `main.db`, and this becomes the resident
  /// window with older messages paged in — the cap stays, its meaning narrows.
  void _setTranscript(List<Message> next) {
    if (next.length <= Limits.maxTranscriptMessages) {
      state = next;
      return;
    }
    final int overflow = next.length - Limits.maxTranscriptMessages;
    _dropped += overflow;
    // Dispose anything still streaming in the dropped range, or its notifier
    // outlives the only widget that listens to it.
    for (final Message m in next.take(overflow)) {
      if (m.streaming != null && m.streaming != _activeNotifier) {
        m.streaming!.dispose();
      }
    }
    state = next.sublist(overflow);
  }

  /// Send a message and stream the reply.
  Future<void> send(String rawText) async {
    // §5: trim on submit — paste and text expansion leave trailing spaces.
    final String text = rawText.trim();
    if (text.isEmpty || isStreaming) return;

    final RudraClient? client = ref.read(clientProvider);
    if (client == null) return;

    final DateTime now = DateTime.now();
    _setTranscript(<Message>[
      ...state,
      Message(
        id: 'local-${now.microsecondsSinceEpoch}',
        author: Author.user,
        text: text,
        createdAt: now,
      ),
    ]);

    final Completer<void> finished = Completer<void>();

    _active = client
        .echo(text)
        .listen(
          (StreamEvent event) => _onEvent(event),
          onError: (Object error) {
            _finish(StreamCompletion.failed(error.toString()));
            if (!finished.isCompleted) finished.complete();
          },
          onDone: () {
            // A stream that ends without a terminal event was cut: say so rather
            // than letting a partial message look finished (PLAN.MD §7).
            _finish(const StreamCompletion.interrupted());
            if (!finished.isCompleted) finished.complete();
          },
          cancelOnError: true,
        );

    await finished.future;
  }

  void _onEvent(StreamEvent event) {
    switch (event) {
      case StreamStart(:final String messageId):
        final StreamingMessage notifier = StreamingMessage(
          messageId: messageId,
        );
        _activeNotifier = notifier;
        _setTranscript(<Message>[
          ...state,
          Message(
            id: messageId,
            author: Author.assistant,
            text: '',
            createdAt: DateTime.now(),
            streaming: notifier,
          ),
        ]);

      case StreamDelta(:final String text):
        // The hot path: straight to the notifier, never through `state`.
        _activeNotifier?.append(text);

      case StreamDone(:final String reason):
        _finish(switch (reason) {
          'complete' => const StreamCompletion.complete(),
          'interrupted' => const StreamCompletion.interrupted(),
          'length' => const StreamCompletion.length(),
          _ => const StreamCompletion.complete(),
        });

      case StreamError(:final ApiError error):
        _finish(StreamCompletion.failed(error.message));
    }
  }

  /// Settle the in-flight message and release its notifier.
  void _finish(StreamCompletion completion) {
    final StreamingMessage? notifier = _activeNotifier;
    unawaited(_active?.cancel());
    _active = null;

    if (notifier == null) return;
    _activeNotifier = null;

    final String finalText = notifier.value;
    state = <Message>[
      for (final Message m in state)
        if (m.id == notifier.messageId) m.settled(finalText, completion) else m,
    ];
    notifier.dispose();
  }

  /// Append messages directly, bypassing the network.
  ///
  /// Exists so the transcript cap can be tested for what it is — a RAM bound —
  /// without standing up a backend and streaming two thousand replies through
  /// it. The cap is enforced on this path exactly as on the live one, because
  /// both go through `_setTranscript`.
  @visibleForTesting
  void appendForTest(Iterable<Message> messages) {
    _setTranscript(<Message>[...state, ...messages]);
  }

  /// Stop the current stream. §4 — cancellation is synchronous in the UI.
  void interrupt() {
    if (!isStreaming) return;
    _finish(const StreamCompletion.interrupted());
  }

  /// Start a new session. §2 — memory only pays off at session boundaries, so
  /// this stays a one-keystroke action.
  void clear() {
    interrupt();
    _dropped = 0;
    state = const <Message>[];
  }
}

import 'package:flutter/material.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/ui/chat/message_notifier.dart';
import 'package:rudra/ui/chat/streaming_text.dart';
import 'package:rudra/ui/common/theme.dart';

/// One message in the transcript.
///
/// §1.1 — flat, not boxed. The user's turn gets a soft fill to mark the edge of
/// the exchange; the assistant's sits directly on the page with no card, so the
/// transcript reads as prose rather than a stack of tiles.
class MessageBubble extends StatelessWidget {
  const MessageBubble({required this.message, super.key});

  final Message message;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final bool isUser = message.author == Author.user;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: RudraTokens.space3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _Byline(author: message.author),
          const SizedBox(height: RudraTokens.space2),
          if (isUser)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: RudraTokens.space4,
                vertical: RudraTokens.space3,
              ),
              decoration: BoxDecoration(
                color: t.bgSecondary,
                borderRadius: BorderRadius.circular(RudraTokens.radiusMd),
              ),
              child: _Body(message: message),
            )
          else
            _Body(message: message),
          if (message.completion?.isPartial ?? false) ...<Widget>[
            const SizedBox(height: RudraTokens.space2),
            _PartialNotice(completion: message.completion!),
          ],
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    final StreamingMessage? streaming = message.streaming;

    // While streaming, this subtree is owned by StreamingText and repaints on
    // its own (INVARIANT 11). Once settled, it is a plain selectable paragraph.
    if (streaming != null) return StreamingText(message: streaming);

    if (message.text.isEmpty) return const SizedBox.shrink();

    return SelectableText(
      message.text,
      style: Theme.of(context).textTheme.bodyLarge,
    );
  }
}

class _Byline extends StatelessWidget {
  const _Byline({required this.author});

  final Author author;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final bool isUser = author == Author.user;

    return Row(
      children: <Widget>[
        Text(
          isUser ? 'You' : 'Rudra',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
            color: isUser ? t.textSecondary : t.accent,
          ),
          // §10: brand names are not translated.
          textScaler: TextScaler.noScaling,
        ),
      ],
    );
  }
}

/// PLAN.MD §7 — a partial message is never presented as a complete one.
class _PartialNotice extends StatelessWidget {
  const _PartialNotice({required this.completion});

  final StreamCompletion completion;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final bool failed = completion.reason == StreamEndReason.failed;

    final (IconData icon, String label) = switch (completion.reason) {
      StreamEndReason.interrupted => (Icons.stop_circle_outlined, 'Stopped'),
      StreamEndReason.length => (
        Icons.more_horiz,
        'Cut off at the length limit',
      ),
      StreamEndReason.failed => (
        Icons.error_outline,
        completion.error ?? 'Failed',
      ),
      StreamEndReason.complete => (Icons.check, 'Complete'),
    };

    return Row(
      children: <Widget>[
        // §10: redundant cues — icon plus text, never colour alone.
        Icon(icon, size: 13, color: failed ? t.danger : t.textTertiary),
        const SizedBox(width: RudraTokens.space1),
        Flexible(
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: failed ? t.danger : t.textTertiary,
            ),
          ),
        ),
      ],
    );
  }
}

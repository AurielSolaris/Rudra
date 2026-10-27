import 'package:flutter/material.dart';
import 'package:rudra/ui/chat/message_notifier.dart';
import 'package:rudra/ui/common/primitives.dart';
import 'package:rudra/ui/common/theme.dart';

/// Renders a message that is still streaming.
///
/// **This is the piece PLAN.MD §10 calls the hardest part of the UI, and
/// INVARIANT 11 is enforced here.**
///
/// The contract: a token delta repaints *this widget and nothing else*. It
/// listens to one [StreamingMessage] through a [ValueListenableBuilder], so the
/// rebuild is scoped to one subtree, and the whole thing sits behind a
/// [RepaintBoundary] so the transcript behind it is not even repainted.
///
/// Phase 1 replaces the `Text` here with the incremental Markdown renderer. The
/// listening and isolation stay exactly as they are — that is the part that has
/// to be right before any Markdown work starts.
class StreamingText extends StatelessWidget {
  const StreamingText({required this.message, super.key});

  final StreamingMessage message;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final TextStyle? style = Theme.of(context).textTheme.bodyLarge;

    return RepaintBoundary(
      child: ValueListenableBuilder<String>(
        valueListenable: message,
        builder: (BuildContext context, String text, _) {
          if (text.isEmpty) {
            // Not "Loading…" (§7) — the loader mark, then the first token
            // replaces it in place with no layout jump.
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: RudraTokens.space1),
              child: SizedBox(height: 20, child: Loader(size: 16)),
            );
          }

          return Text.rich(
            TextSpan(
              children: <InlineSpan>[
                TextSpan(text: text, style: style),
                // A cursor while tokens are still arriving. It is part of the
                // same paragraph, so it never reflows the text when it goes.
                if (!message.isComplete)
                  WidgetSpan(
                    alignment: PlaceholderAlignment.middle,
                    child: _Caret(color: t.accent),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// A blinking caret shown while a stream is live.
class _Caret extends StatefulWidget {
  const _Caret({required this.color});

  final Color color;

  @override
  State<_Caret> createState() => _CaretState();
}

class _CaretState extends State<_Caret> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // §8: reduced motion gets a steady caret, not a blinking one.
    if (MediaQuery.disableAnimationsOf(context)) {
      return _CaretBar(color: widget.color, opacity: 1);
    }

    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _c,
        builder: (BuildContext context, _) {
          // §8: animate opacity, never layout. The bar's box never changes.
          final double o = _c.value < 0.5 ? 1.0 : 0.15;
          return _CaretBar(color: widget.color, opacity: o);
        },
      ),
    );
  }
}

class _CaretBar extends StatelessWidget {
  const _CaretBar({required this.color, required this.opacity});

  final Color color;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 2),
      child: Container(
        width: 2,
        height: 15,
        decoration: BoxDecoration(
          color: color.withValues(alpha: opacity),
          borderRadius: BorderRadius.circular(1),
        ),
      ),
    );
  }
}

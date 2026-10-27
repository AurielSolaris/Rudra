import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/ui/chat/composer.dart';
import 'package:rudra/ui/chat/message_bubble.dart';
import 'package:rudra/ui/common/primitives.dart';
import 'package:rudra/ui/common/theme.dart';

/// The transcript.
///
/// §11: **virtualized.** A `ListView.builder` builds only what is visible, so a
/// 5,000-message transcript costs the same as a 20-message one. A `Column`
/// inside a `SingleChildScrollView` would build every message on every frame —
/// the rule exists because that is the easy mistake to make here.
class ChatView extends ConsumerStatefulWidget {
  const ChatView({super.key});

  @override
  ConsumerState<ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends ConsumerState<ChatView> {
  final ScrollController _scroll = ScrollController();

  /// Whether the view is pinned to the bottom. A person who has scrolled up to
  /// read something must not be yanked back down by an arriving token.
  bool _pinned = true;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    // Within a line or two of the bottom still counts as pinned.
    const double slack = 48;
    final bool atBottom =
        _scroll.position.pixels >= _scroll.position.maxScrollExtent - slack;
    if (atBottom != _pinned) setState(() => _pinned = atBottom);
  }

  void _scrollToBottom({bool animate = true}) {
    if (!_scroll.hasClients) return;
    final double target = _scroll.position.maxScrollExtent;
    if (animate && !MediaQuery.disableAnimationsOf(context)) {
      // Discarding deliberately: the scroll is fire-and-forget, and awaiting
      // it would block on an animation the user can interrupt.
      _scroll
          .animateTo(
            target,
            duration: RudraTokens.durationSurface,
            curve: Curves.easeOutCubic,
          )
          .ignore();
    } else {
      _scroll.jumpTo(target);
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<TranscriptMessage> messages = ref.watch(messagesProvider);

    // Follow the tail only while pinned. Scheduled post-frame so it runs after
    // the new message has been laid out.
    if (_pinned && messages.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _scrollToBottom(animate: false);
      });
    }

    return Column(
      children: <Widget>[
        Expanded(
          child: Stack(
            children: <Widget>[
              if (messages.isEmpty)
                const EmptyState(
                  title: 'Nothing here yet',
                  subtitle:
                      'This is the Phase 0 spine: the backend echoes what you '
                      'send, one chunk at a time, over SSE. A real model '
                      'arrives in Phase 1.',
                  icon: Icons.forum_outlined,
                )
              else
                ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.symmetric(
                    horizontal: RudraTokens.pageInsetX,
                    vertical: RudraTokens.space4,
                  ),
                  itemCount: messages.length,
                  // A stable key per message, so scroll position survives the
                  // list changing underneath it.
                  itemBuilder: (BuildContext context, int index) {
                    final TranscriptMessage message = messages[index];
                    return Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(
                          maxWidth: RudraTokens.transcriptMaxWidth,
                        ),
                        child: MessageBubble(
                          key: ValueKey<String>(message.id),
                          message: message,
                        ),
                      ),
                    );
                  },
                ),
              if (!_pinned && messages.isNotEmpty)
                Positioned(
                  right: RudraTokens.space4,
                  bottom: RudraTokens.space4,
                  child: _JumpToLatest(onPressed: _scrollToBottom),
                ),
            ],
          ),
        ),
        const Composer(),
      ],
    );
  }
}

/// Shown only when scrolled away from the tail. §1.6 — surface the action,
/// but never scroll the view on someone's behalf.
class _JumpToLatest extends StatelessWidget {
  const _JumpToLatest({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(RudraTokens.radiusSm),
        // §1.2 — borderless elevation: a layered shadow plus a hairline.
        boxShadow: <BoxShadow>[
          for (final Shadow s in t.shadowMenu)
            BoxShadow(
              color: s.color,
              blurRadius: s.blurRadius,
              offset: s.offset,
            ),
        ],
      ),
      child: RudraButton(
        label: 'Latest',
        icon: Icons.arrow_downward,
        size: RudraButtonSize.small,
        onPressed: onPressed,
        semanticLabel: 'Scroll to the latest message',
      ),
    );
  }
}

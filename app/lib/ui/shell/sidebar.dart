import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/state/sidecar_store.dart';
import 'package:rudra/ui/common/primitives.dart';
import 'package:rudra/ui/common/theme.dart';

/// The left rail.
///
/// §2 — **"New session" is a first-class, one-keystroke action.** Memory only
/// pays off at session boundaries (PLAN.MD §5.6), so starting one has to feel
/// cheap. It is also bound to Ctrl/Cmd+N in the shell; §2 requires both
/// affordances to invoke the same action, which they do.
///
/// The session list itself is Phase 1, when sessions are persisted.
class Sidebar extends ConsumerWidget {
  const Sidebar({super.key});

  static const double width = 232;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final RudraTokens t = context.tokens;
    final int messageCount = ref.watch(messagesProvider).length;

    return SizedBox(
      width: width,
      child: ColoredBox(
        color: t.bgSecondary,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: RudraTokens.space3,
            vertical: RudraTokens.space4,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: RudraTokens.space1,
                ),
                child: Row(
                  children: <Widget>[
                    Text(
                      'Rudra',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(width: RudraTokens.space2),
                    // The caduceus: Rudra as healer, holder of the remedy.
                    Text(
                      '☤',
                      style: Theme.of(
                        context,
                      ).textTheme.titleMedium?.copyWith(color: t.accent),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: RudraTokens.space4),
              RudraButton(
                label: 'New session',
                icon: Icons.add,
                variant: RudraButtonVariant.secondary,
                onPressed: messageCount == 0
                    ? null
                    : () => ref.read(messagesProvider.notifier).clear(),
                semanticLabel: 'Start a new session (Ctrl+N)',
              ),
              const SizedBox(height: RudraTokens.space5),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: RudraTokens.space1,
                ),
                child: Text(
                  'Sessions',
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ),
              const SizedBox(height: RudraTokens.space2),
              // §7: the empty state is designed, not left blank.
              Expanded(
                child: Align(
                  alignment: Alignment.topLeft,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: RudraTokens.space1,
                    ),
                    child: Text(
                      'Saved sessions arrive in Phase 1, with the transcript in '
                      'SQLite and full-text search over it.',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                ),
              ),
              const _BackendStatus(),
            ],
          ),
        ),
      ),
    );
  }
}

/// A quiet footer showing what the app is talking to.
///
/// Useful during Phase 0 — and §10's rule applies: the status is never conveyed
/// by colour alone, so the dot is paired with text.
class _BackendStatus extends ConsumerWidget {
  const _BackendStatus();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final RudraTokens t = context.tokens;
    final SidecarState sidecar = ref.watch(sidecarProvider);
    final bool ready = sidecar.isReady;

    return Tooltip(
      message: ready
          // Never the token — only the port.
          ? 'Backend on 127.0.0.1:${sidecar.handshake?.port}'
          : sidecar.message ?? 'Backend not ready',
      waitDuration: const Duration(milliseconds: 500),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: RudraTokens.space1),
        child: Row(
          children: <Widget>[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: ready ? t.accent : t.textTertiary,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: RudraTokens.space2),
            Expanded(
              child: Text(
                ready ? 'Backend ready' : 'Backend starting…',
                style: Theme.of(context).textTheme.labelSmall,
                maxLines: 1,
                // §9: text containers handle long content.
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

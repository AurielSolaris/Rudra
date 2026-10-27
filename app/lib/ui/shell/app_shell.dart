import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/state/sidecar_store.dart';
import 'package:rudra/ui/chat/chat_view.dart';
import 'package:rudra/ui/common/primitives.dart';
import 'package:rudra/ui/common/theme.dart';
import 'package:rudra/ui/shell/sidebar.dart';

/// The window.
///
/// §2 — chat is the home surface: the transcript and composer stay primary, and
/// the sidebar complements them. Panes and overlays arrive in later phases
/// without displacing this arrangement.
class AppShell extends ConsumerWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final RudraTokens t = context.tokens;

    return Shortcuts(
      // §3: shortcuts are registered through one shared layer, never as ad-hoc
      // key listeners scattered through the tree.
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.keyN, control: true):
            _NewSessionIntent(),
        SingleActivator(LogicalKeyboardKey.keyN, meta: true):
            _NewSessionIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          _NewSessionIntent: CallbackAction<_NewSessionIntent>(
            onInvoke: (_) {
              ref.read(messagesProvider.notifier).clear();
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          // A Material ancestor is required by TextField (and by text
          // selection). Scaffold provides it and paints the background, so no
          // surface in the tree is left undefined (§13).
          child: Scaffold(
            backgroundColor: t.bgPrimary,
            body: const Row(
              children: <Widget>[
                Sidebar(),
                // §1.1 — group with a single hairline, never a nested box.
                _VerticalHairline(),
                Expanded(child: ChatView()),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NewSessionIntent extends Intent {
  const _NewSessionIntent();
}

class _VerticalHairline extends StatelessWidget {
  const _VerticalHairline();

  @override
  Widget build(BuildContext context) {
    return Container(width: 1, color: context.tokens.strokeTertiary);
  }
}

/// What the window shows before the backend is ready.
///
/// §7 — every state is designed: starting, failed, ready. A failure shows the
/// reason and a way forward rather than a spinner that never resolves.
class BootGate extends ConsumerStatefulWidget {
  const BootGate({super.key});

  @override
  ConsumerState<BootGate> createState() => _BootGateState();
}

class _BootGateState extends ConsumerState<BootGate> {
  @override
  void initState() {
    super.initState();
    // Start the backend as soon as the first frame is scheduled.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(sidecarProvider.notifier).boot().ignore();
    });
  }

  @override
  Widget build(BuildContext context) {
    final SidecarState sidecar = ref.watch(sidecarProvider);

    return switch (sidecar.phase) {
      SidecarPhase.ready => const AppShell(),
      SidecarPhase.failed => _BootFailed(state: sidecar),
      SidecarPhase.idle ||
      SidecarPhase.starting ||
      SidecarPhase.stopped => _BootProgress(state: sidecar),
    };
  }
}

class _BootProgress extends StatelessWidget {
  const _BootProgress({required this.state});

  final SidecarState state;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;

    return Scaffold(
      backgroundColor: t.bgPrimary,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Loader(size: 28, semanticLabel: 'Starting Rudra'),
            const SizedBox(height: RudraTokens.space4),
            Text(
              // §7: never the literal text "Loading…" — say what is happening.
              state.message ?? 'Starting…',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _BootFailed extends ConsumerWidget {
  const _BootFailed({required this.state});

  final SidecarState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final RudraTokens t = context.tokens;

    final String detail = <String>[
      if (state.message != null) state.message!,
      if (state.logTail.isNotEmpty) ...<String>[
        '',
        '--- backend log ---',
        ...state.logTail,
      ],
    ].join('\n');

    return Scaffold(
      backgroundColor: t.bgPrimary,
      body: ErrorState(
        title: 'Rudra could not start its backend',
        detail: detail.isEmpty ? null : detail,
        actionLabel: 'Try again',
        onAction: () => ref.read(sidecarProvider.notifier).retry().ignore(),
      ),
    );
  }
}

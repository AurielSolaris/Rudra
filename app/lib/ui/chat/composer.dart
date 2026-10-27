import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/state/sidecar_store.dart';
import 'package:rudra/ui/common/primitives.dart';
import 'package:rudra/ui/common/theme.dart';

/// The input.
///
/// Keyboard contract from docs/ui-guidelineses §5:
///   - **Enter** inserts a newline (this is a multiline composer)
///   - **Ctrl/Cmd+Enter** submits
///   - **Esc** interrupts a running stream — and does exactly one thing (§4)
class Composer extends ConsumerStatefulWidget {
  const Composer({super.key});

  @override
  ConsumerState<Composer> createState() => _ComposerState();
}

class _ComposerState extends ConsumerState<Composer> {
  // §5: an uncontrolled field — the controller owns the text, so app state is
  // not rebuilt per keystroke (§11).
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focus = FocusNode(debugLabel: 'composer');

  bool _canSend = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_onChanged)
      ..dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onChanged() {
    final bool next = _controller.text.trim().isNotEmpty;
    if (next != _canSend) setState(() => _canSend = next);
  }

  void _submit() {
    final MessageStore store = ref.read(messagesProvider.notifier);
    if (store.isStreaming) return;

    final String text = _controller.text;
    if (text.trim().isEmpty) return;

    _controller.clear();
    // Keep focus in the composer: the next thing a person does is type again.
    _focus.requestFocus();

    // Fire and forget — the stream drives the transcript, not this callback.
    store.send(text).ignore();
  }

  void _interrupt() => ref.read(messagesProvider.notifier).interrupt();

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;

    // Watching the message list is what tells us whether a stream is running.
    ref.watch(messagesProvider);
    final MessageStore store = ref.read(messagesProvider.notifier);
    final bool streaming = store.isStreaming;
    final bool ready = ref.watch(sidecarProvider).isReady;

    return Container(
      decoration: BoxDecoration(
        color: t.bgPrimary,
        // §1.1 — a single hairline, not a framed box.
        border: Border(top: BorderSide(color: t.strokeTertiary)),
      ),
      padding: const EdgeInsets.fromLTRB(
        RudraTokens.pageInsetX,
        RudraTokens.space3,
        RudraTokens.pageInsetX,
        RudraTokens.space4,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: RudraTokens.transcriptMaxWidth,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _InputSurface(
                controller: _controller,
                focus: _focus,
                enabled: ready && !streaming,
                onSubmit: _submit,
                onInterrupt: _interrupt,
                streaming: streaming,
              ),
              const SizedBox(height: RudraTokens.space2),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      streaming
                          ? 'Esc to stop'
                          : 'Ctrl+Enter to send · Enter for a new line',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                  if (streaming)
                    RudraButton(
                      label: 'Stop',
                      icon: Icons.stop,
                      size: RudraButtonSize.small,
                      variant: RudraButtonVariant.secondary,
                      onPressed: _interrupt,
                      semanticLabel: 'Stop generating',
                    )
                  else
                    RudraButton(
                      label: 'Send',
                      icon: Icons.arrow_upward,
                      size: RudraButtonSize.small,
                      variant: RudraButtonVariant.primary,
                      // §5: stays enabled until the request actually starts.
                      onPressed: _canSend && ready ? _submit : null,
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InputSurface extends StatefulWidget {
  const _InputSurface({
    required this.controller,
    required this.focus,
    required this.enabled,
    required this.onSubmit,
    required this.onInterrupt,
    required this.streaming,
  });

  final TextEditingController controller;
  final FocusNode focus;
  final bool enabled;
  final VoidCallback onSubmit;
  final VoidCallback onInterrupt;
  final bool streaming;

  @override
  State<_InputSurface> createState() => _InputSurfaceState();
}

class _InputSurfaceState extends State<_InputSurface> {
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    widget.focus.addListener(_onFocus);
  }

  @override
  void dispose() {
    widget.focus.removeListener(_onFocus);
    super.dispose();
  }

  void _onFocus() {
    if (widget.focus.hasFocus != _focused) {
      setState(() => _focused = widget.focus.hasFocus);
    }
  }

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;

    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        // Both modifiers, because this is a cross-platform desktop app.
        const SingleActivator(LogicalKeyboardKey.enter, control: true):
            widget.onSubmit,
        const SingleActivator(LogicalKeyboardKey.enter, meta: true):
            widget.onSubmit,
        // §4: one cancel gesture, one job. While streaming, Esc stops it.
        if (widget.streaming)
          const SingleActivator(LogicalKeyboardKey.escape): widget.onInterrupt,
      },
      child: AnimatedContainer(
        duration: RudraTokens.durationControl,
        decoration: BoxDecoration(
          color: t.widgetSurface,
          borderRadius: BorderRadius.circular(RudraTokens.radiusMd),
          border: Border.all(
            // §10: contrast increases on focus.
            color: _focused ? t.accent : t.strokeTertiary,
            width: _focused ? 1.5 : 1,
          ),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: RudraTokens.space4,
          vertical: RudraTokens.space3,
        ),
        child: TextField(
          controller: widget.controller,
          focusNode: widget.focus,
          enabled: widget.enabled,
          maxLines: 8,
          minLines: 2,
          // §5: never block paste; never disable selection.
          enableInteractiveSelection: true,
          // §5: spellcheck off for a field full of paths and identifiers.
          spellCheckConfiguration: const SpellCheckConfiguration.disabled(),
          keyboardType: TextInputType.multiline,
          textInputAction: TextInputAction.newline,
          style: Theme.of(context).textTheme.bodyLarge,
          cursorColor: t.accent,
          decoration: InputDecoration(
            isDense: true,
            border: InputBorder.none,
            focusedBorder: InputBorder.none,
            enabledBorder: InputBorder.none,
            disabledBorder: InputBorder.none,
            contentPadding: EdgeInsets.zero,
            // §5: placeholders end with an ellipsis and show the shape.
            hintText: widget.streaming
                ? 'Rudra is replying…'
                : 'Ask Rudra anything…',
            hintStyle: Theme.of(
              context,
            ).textTheme.bodyLarge?.copyWith(color: t.textTertiary),
          ),
        ),
      ),
    );
  }
}

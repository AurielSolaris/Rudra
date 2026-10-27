import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:rudra/ui/common/theme.dart';

/// Shared primitives.
///
/// INVARIANT 12 (MAP.txt): **one primitive per concern.** A forked button at a
/// call site is a bug, not a shortcut. Call sites pass `variant` and `size`;
/// they never pass padding, height or icon size (docs/ui-guidelines.md §1.5).

enum RudraButtonVariant {
  /// The primary action. One per surface.
  primary,

  /// Destructive. Always paired with a confirm or an undo (§7).
  destructive,

  /// Soft fill — the default non-primary look.
  secondary,

  /// Transparent with a hairline ring.
  outline,

  /// No chrome until hover.
  ghost,

  /// Boxless inline text — "Cancel", "Clear".
  text,
}

enum RudraButtonSize { small, medium }

/// The only button.
class RudraButton extends StatefulWidget {
  const RudraButton({
    required this.label,
    required this.onPressed,
    super.key,
    this.variant = RudraButtonVariant.secondary,
    this.size = RudraButtonSize.medium,
    this.icon,
    this.busy = false,
    this.semanticLabel,
  });

  final String label;

  /// Null disables the button. §5 — keep it enabled until a request starts.
  final VoidCallback? onPressed;
  final RudraButtonVariant variant;
  final RudraButtonSize size;
  final IconData? icon;

  /// Shows a spinner and **keeps the original label** (§5).
  final bool busy;

  /// Required when the label alone is not descriptive (§10).
  final String? semanticLabel;

  @override
  State<RudraButton> createState() => _RudraButtonState();
}

class _RudraButtonState extends State<RudraButton> {
  bool _hovered = false;
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final bool enabled = widget.onPressed != null && !widget.busy;

    final (Color bg, Color fg, Color? border) = switch (widget.variant) {
      // Not Colors.white: on the dark theme's light accent a white label is
      // unreadable (2.35:1). The token flips with the theme (§10).
      RudraButtonVariant.primary => (t.accent, t.onAccent, null),
      RudraButtonVariant.destructive => (t.danger, t.onDanger, null),
      RudraButtonVariant.secondary => (t.bgQuaternary, t.textPrimary, null),
      RudraButtonVariant.outline => (
        Colors.transparent,
        t.textPrimary,
        t.strokeSecondary,
      ),
      RudraButtonVariant.ghost => (
        _hovered ? t.actionHover : Colors.transparent,
        t.textPrimary,
        null,
      ),
      RudraButtonVariant.text => (Colors.transparent, t.textSecondary, null),
    };

    final double height = widget.size == RudraButtonSize.small ? 26 : 32;
    final double padH = widget.size == RudraButtonSize.small
        ? RudraTokens.space2
        : RudraTokens.space3;
    final double iconSize = widget.size == RudraButtonSize.small ? 13 : 15;

    // §8: hover paints instantly, only the return eases. So the duration is
    // zero on the way in and `durationControl` on the way out.
    final Duration duration = _hovered
        ? RudraTokens.durationInstant
        : RudraTokens.durationControl;

    Widget content = Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (widget.busy)
          SizedBox(
            width: iconSize,
            height: iconSize,
            child: CircularProgressIndicator(
              strokeWidth: 1.6,
              color: fg.withValues(alpha: 0.8),
            ),
          )
        else if (widget.icon != null)
          Icon(widget.icon, size: iconSize, color: fg),
        if (widget.busy || widget.icon != null)
          const SizedBox(width: RudraTokens.space2),
        Text(
          widget.label,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
            color: enabled ? fg : fg.withValues(alpha: 0.45),
          ),
        ),
      ],
    );

    content = AnimatedContainer(
      duration: duration,
      height: height,
      padding: EdgeInsets.symmetric(horizontal: padH),
      decoration: BoxDecoration(
        // §10: contrast increases on hover, never decreases.
        color: enabled
            ? (_hovered ? _lift(bg, t) : bg)
            : bg.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(RudraTokens.radiusSm),
        border: border == null ? null : Border.all(color: border, width: 1),
      ),
      child: Center(child: content),
    );

    // §3: a visible focus ring, unobscured, on every focusable widget.
    if (_focused) {
      content = DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(RudraTokens.radiusSm + 2),
          border: Border.all(color: t.accent, width: 2),
        ),
        child: Padding(padding: const EdgeInsets.all(1), child: content),
      );
    }

    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticLabel ?? widget.label,
      child: FocusableActionDetector(
        enabled: enabled,
        onShowHoverHighlight: (bool v) => setState(() => _hovered = v),
        onShowFocusHighlight: (bool v) => setState(() => _focused = v),
        mouseCursor: enabled
            ? SystemMouseCursors.click
            : SystemMouseCursors.basic,
        shortcuts: const <ShortcutActivator, Intent>{
          SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        },
        actions: <Type, Action<Intent>>{
          ActivateIntent: CallbackAction<ActivateIntent>(
            onInvoke: (_) {
              widget.onPressed?.call();
              return null;
            },
          ),
        },
        child: GestureDetector(
          onTap: enabled ? widget.onPressed : null,
          // §5: expand the hit area, never the paint.
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: RudraTokens.minTarget,
              minWidth: RudraTokens.minTarget,
            ),
            child: content,
          ),
        ),
      ),
    );
  }

  /// Nudge a fill toward more contrast for hover.
  Color _lift(Color base, RudraTokens t) {
    if (base == Colors.transparent) return t.actionHover;
    final HSLColor hsl = HSLColor.fromColor(base);
    final double target = hsl.lightness > 0.5
        ? (hsl.lightness - 0.04).clamp(0.0, 1.0)
        : (hsl.lightness + 0.06).clamp(0.0, 1.0);
    return hsl.withLightness(target).toColor();
  }
}

/// The only loader.
///
/// §7: **never ship the literal text "Loading…".** Hermes animates ASCII/math
/// curves; ours is a slow caduceus-staff pulse — three dots on a vertical axis,
/// which reads as motion without implying a progress amount we do not know.
class Loader extends StatefulWidget {
  const Loader({super.key, this.size = 18, this.semanticLabel = 'Working'});

  final double size;
  final String semanticLabel;

  @override
  State<Loader> createState() => _LoaderState();
}

class _LoaderState extends State<Loader> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void initState() {
    super.initState();
    // §8: honour reduced motion. A static mark still communicates "busy";
    // the build method swaps to it, so the controller can spin harmlessly.
    _c.repeat().ignore();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final bool reduceMotion = MediaQuery.disableAnimationsOf(context);

    if (reduceMotion) {
      return Semantics(
        label: widget.semanticLabel,
        child: Icon(Icons.more_horiz, size: widget.size, color: t.textTertiary),
      );
    }

    return Semantics(
      label: widget.semanticLabel,
      // §11: an independently animating subtree gets its own layer, so it does
      // not repaint the transcript behind it.
      child: RepaintBoundary(
        child: SizedBox(
          width: widget.size,
          height: widget.size,
          child: AnimatedBuilder(
            animation: _c,
            builder: (BuildContext context, _) {
              return CustomPaint(
                painter: _LoaderPainter(progress: _c.value, color: t.accent),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _LoaderPainter extends CustomPainter {
  _LoaderPainter({required this.progress, required this.color});

  final double progress;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()..color = color;
    const int count = 3;
    final double r = size.width / 8;
    final double step = size.height / (count + 1);

    for (int i = 0; i < count; i++) {
      // Each dot trails the one above it, so the pulse travels downward.
      final double phase = (progress - i * 0.16) % 1.0;
      final double wave = (1 - (phase * 2 - 1).abs()).clamp(0.0, 1.0);
      paint.color = color.withValues(alpha: 0.25 + 0.75 * wave);
      canvas.drawCircle(
        Offset(size.width / 2, step * (i + 1)),
        r * (0.7 + 0.5 * wave),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_LoaderPainter old) =>
      old.progress != progress || old.color != color;
}

/// The only error surface.
///
/// §7: one look for the error boundary, in-dialog errors and the boot-failure
/// banner. Always offers a next step — no dead ends.
class ErrorState extends StatelessWidget {
  const ErrorState({
    required this.title,
    super.key,
    this.detail,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? detail;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final String? detailText = detail;

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: const EdgeInsets.all(RudraTokens.pageInsetX),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  // §10: never colour alone — an icon carries the meaning too.
                  Icon(Icons.error_outline, size: 18, color: t.danger),
                  const SizedBox(width: RudraTokens.space2),
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                ],
              ),
              if (detailText != null) ...<Widget>[
                const SizedBox(height: RudraTokens.space3),
                LogView(text: detailText),
              ],
              if (onAction != null && actionLabel != null) ...<Widget>[
                const SizedBox(height: RudraTokens.space4),
                RudraButton(
                  label: actionLabel!,
                  variant: RudraButtonVariant.primary,
                  onPressed: onAction,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The only empty surface. §7 — every surface designs its empty state.
class EmptyState extends StatelessWidget {
  const EmptyState({required this.title, super.key, this.subtitle, this.icon});

  final String title;
  final String? subtitle;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;
    final String? sub = subtitle;

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 28, color: t.textTertiary),
            const SizedBox(height: RudraTokens.space3),
          ],
          Text(
            title,
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          if (sub != null) ...<Widget>[
            const SizedBox(height: RudraTokens.space2),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Text(
                sub,
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The only raw-output surface.
///
/// §7: no background, a hairline border, tight padding, small mono. Used
/// wherever we surface logs or a stack of detail.
class LogView extends StatelessWidget {
  const LogView({required this.text, super.key, this.maxHeight = 200});

  final String text;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    final RudraTokens t = context.tokens;

    return Container(
      constraints: BoxConstraints(maxHeight: maxHeight),
      width: double.infinity,
      decoration: BoxDecoration(
        border: Border.all(color: t.strokeTertiary),
        borderRadius: BorderRadius.circular(RudraTokens.radiusSm),
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: RudraTokens.space3,
        vertical: RudraTokens.space2,
      ),
      child: SingleChildScrollView(
        child: SelectableText(
          text,
          style: kMonoStyle.copyWith(color: t.textSecondary),
        ),
      ),
    );
  }
}

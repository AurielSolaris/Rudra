import 'package:flutter/material.dart';

/// Design tokens.
///
/// INVARIANT 13 (MAP.txt): **no raw colour, shadow, radius or duration literal
/// in any widget.** Everything resolves through here. The literals in this file
/// are the only ones in the app, which is what makes retheming a one-file change.
///
/// The vocabulary deliberately mirrors Hermes' (`--ui-stroke-*`, `--ui-text-*`,
/// …) so the two systems stay legible to each other. See
/// docs/ui-guidelines.md §13.
@immutable
class RudraTokens extends ThemeExtension<RudraTokens> {
  const RudraTokens({
    required this.strokePrimary,
    required this.strokeSecondary,
    required this.strokeTertiary,
    required this.strokeOverlay,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.bgPrimary,
    required this.bgSecondary,
    required this.bgTertiary,
    required this.bgQuaternary,
    required this.widgetSurface,
    required this.actionHover,
    required this.accent,
    required this.accentMuted,
    required this.onAccent,
    required this.danger,
    required this.onDanger,
    required this.shadowOverlay,
    required this.shadowMenu,
  });

  /// Light theme.
  ///
  /// Hue family derived from the user's cursor set: the blues there cluster at
  /// **hue 213-222**, with a cyan highlight near 195 and indigo depth at 240.
  /// Only the colour statistics were taken — no artwork, no icon, nothing
  /// copyable. The neutrals are tinted toward hue 220 so borders, shadows and
  /// secondary text sit in the same family as the accent (§13).
  ///
  /// Every pair below is contrast-checked; see the `contrast` test group.
  factory RudraTokens.light() => const RudraTokens(
    strokePrimary: Color(0xFF101723),
    strokeSecondary: Color(0x33101723),
    strokeTertiary: Color(0x1A101723),
    strokeOverlay: Color(0x14081528),
    textPrimary: Color(0xFF101723),
    textSecondary: Color(0xFF495569),
    textTertiary: Color(0xFF78869A),
    bgPrimary: Color(0xFFFAFBFD),
    bgSecondary: Color(0xFFF0F4FA),
    bgTertiary: Color(0xFFE4EAF4),
    bgQuaternary: Color(0xFFD6DFEE),
    widgetSurface: Color(0xFFFFFFFF),
    actionHover: Color(0x0F0B57BE),
    // The cursors' strongest azure (#0858B8, hue 213 sat 92%), nudged to clear
    // 4.5:1 against white for its label.
    accent: Color(0xFF0B57BE),
    accentMuted: Color(0x1F0B57BE),
    onAccent: Color(0xFFFFFFFF),
    danger: Color(0xFFB3261E),
    onDanger: Color(0xFFFFFFFF),
    // Shadows tinted toward the background hue rather than neutral black (§13).
    shadowOverlay: <Shadow>[
      Shadow(color: Color(0x14081528), blurRadius: 2, offset: Offset(0, 1)),
      Shadow(color: Color(0x1F081528), blurRadius: 24, offset: Offset(0, 8)),
    ],
    shadowMenu: <Shadow>[
      Shadow(color: Color(0x1A081528), blurRadius: 10, offset: Offset(0, 4)),
    ],
  );

  /// Dark theme.
  ///
  /// Not an inversion. The backgrounds take the cursors' deep navy (hue 220-240)
  /// desaturated to a usable surface, and the accent flips to their light sky
  /// blue (#68A8F8) because the deep azure disappears on a dark ground.
  /// [onAccent] flips with it — see that field.
  factory RudraTokens.dark() => const RudraTokens(
    strokePrimary: Color(0xFFE6ECF6),
    strokeSecondary: Color(0x33E6ECF6),
    strokeTertiary: Color(0x1FE6ECF6),
    strokeOverlay: Color(0x266FACF7),
    textPrimary: Color(0xFFE6ECF6),
    textSecondary: Color(0xFF9BA8BC),
    textTertiary: Color(0xFF6B7A8E),
    bgPrimary: Color(0xFF0B0F17),
    bgSecondary: Color(0xFF121824),
    bgTertiary: Color(0xFF1A2231),
    bgQuaternary: Color(0xFF273244),
    widgetSurface: Color(0xFF121824),
    actionHover: Color(0x146FACF7),
    accent: Color(0xFF6FACF7),
    accentMuted: Color(0x246FACF7),
    // Dark label on a light fill. White here measures 2.35:1.
    onAccent: Color(0xFF0B0F17),
    danger: Color(0xFFF08A80),
    onDanger: Color(0xFF0B0F17),
    shadowOverlay: <Shadow>[
      Shadow(color: Color(0x59000000), blurRadius: 2, offset: Offset(0, 1)),
      Shadow(color: Color(0x73000000), blurRadius: 24, offset: Offset(0, 8)),
    ],
    shadowMenu: <Shadow>[
      Shadow(color: Color(0x59000000), blurRadius: 10, offset: Offset(0, 4)),
    ],
  );

  // ---- Stroke: hairlines, in descending strength -------------------------
  final Color strokePrimary;
  final Color strokeSecondary;

  /// The default in-panel divider. Prefer spacing to a divider (§9).
  final Color strokeTertiary;

  /// Pairs with [shadowOverlay] on floating surfaces (§1.2).
  final Color strokeOverlay;

  // ---- Text hierarchy ----------------------------------------------------
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;

  // ---- Background --------------------------------------------------------
  final Color bgPrimary;
  final Color bgSecondary;
  final Color bgTertiary;

  /// Soft control fill — the secondary button's background.
  final Color bgQuaternary;

  /// Fill for inline chat widgets (tool-call cards, code blocks).
  final Color widgetSurface;

  // ---- Interaction -------------------------------------------------------
  final Color actionHover;

  // ---- Accent ------------------------------------------------------------
  final Color accent;
  final Color accentMuted;

  /// Label colour on an [accent] fill.
  ///
  /// NOT always white. The dark theme's accent is a light sky blue, where a
  /// white label measures 2.35:1 — unreadable. Dark mode puts the deep navy on
  /// it instead, at 8.15:1. This token exists because hardcoding white was a
  /// real contrast bug (§10).
  final Color onAccent;

  final Color danger;

  /// Label colour on a [danger] fill. Same reasoning as [onAccent].
  final Color onDanger;

  // ---- Elevation ---------------------------------------------------------
  final List<Shadow> shadowOverlay;
  final List<Shadow> shadowMenu;

  // ---- Shape: concentric, child radius <= parent (§13) -------------------
  static const double radiusSm = 6;
  static const double radiusMd = 10;
  static const double radiusLg = 16;

  // ---- Spacing -----------------------------------------------------------
  static const double space1 = 4;
  static const double space2 = 8;
  static const double space3 = 12;
  static const double space4 = 16;
  static const double space5 = 24;
  static const double space6 = 32;

  /// Page side gutter. §9 — one source, never a hardcoded padding on a page.
  static const double pageInsetX = 24;

  /// Transcript measure. Text never runs the full width of a 34" display (§9).
  static const double transcriptMaxWidth = 740;

  // ---- Motion (§8) -------------------------------------------------------
  /// Paints in the current frame. For selection and pressed feedback.
  static const Duration durationInstant = Duration.zero;

  /// Controls: ~100ms, quick and functional.
  static const Duration durationControl = Duration(milliseconds: 100);

  /// Surfaces appearing or dismissing.
  static const Duration durationSurface = Duration(milliseconds: 180);

  // ---- Targets (§5) ------------------------------------------------------
  /// Minimum hit target on desktop. Expand the hit area, not the paint.
  static const double minTarget = 24;

  @override
  RudraTokens copyWith({
    Color? strokePrimary,
    Color? strokeSecondary,
    Color? strokeTertiary,
    Color? strokeOverlay,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? bgPrimary,
    Color? bgSecondary,
    Color? bgTertiary,
    Color? bgQuaternary,
    Color? widgetSurface,
    Color? actionHover,
    Color? accent,
    Color? accentMuted,
    Color? onAccent,
    Color? danger,
    Color? onDanger,
    List<Shadow>? shadowOverlay,
    List<Shadow>? shadowMenu,
  }) {
    return RudraTokens(
      strokePrimary: strokePrimary ?? this.strokePrimary,
      strokeSecondary: strokeSecondary ?? this.strokeSecondary,
      strokeTertiary: strokeTertiary ?? this.strokeTertiary,
      strokeOverlay: strokeOverlay ?? this.strokeOverlay,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
      bgPrimary: bgPrimary ?? this.bgPrimary,
      bgSecondary: bgSecondary ?? this.bgSecondary,
      bgTertiary: bgTertiary ?? this.bgTertiary,
      bgQuaternary: bgQuaternary ?? this.bgQuaternary,
      widgetSurface: widgetSurface ?? this.widgetSurface,
      actionHover: actionHover ?? this.actionHover,
      accent: accent ?? this.accent,
      accentMuted: accentMuted ?? this.accentMuted,
      onAccent: onAccent ?? this.onAccent,
      danger: danger ?? this.danger,
      onDanger: onDanger ?? this.onDanger,
      shadowOverlay: shadowOverlay ?? this.shadowOverlay,
      shadowMenu: shadowMenu ?? this.shadowMenu,
    );
  }

  @override
  RudraTokens lerp(ThemeExtension<RudraTokens>? other, double t) {
    if (other is! RudraTokens) return this;
    return RudraTokens(
      strokePrimary: Color.lerp(strokePrimary, other.strokePrimary, t)!,
      strokeSecondary: Color.lerp(strokeSecondary, other.strokeSecondary, t)!,
      strokeTertiary: Color.lerp(strokeTertiary, other.strokeTertiary, t)!,
      strokeOverlay: Color.lerp(strokeOverlay, other.strokeOverlay, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      bgPrimary: Color.lerp(bgPrimary, other.bgPrimary, t)!,
      bgSecondary: Color.lerp(bgSecondary, other.bgSecondary, t)!,
      bgTertiary: Color.lerp(bgTertiary, other.bgTertiary, t)!,
      bgQuaternary: Color.lerp(bgQuaternary, other.bgQuaternary, t)!,
      widgetSurface: Color.lerp(widgetSurface, other.widgetSurface, t)!,
      actionHover: Color.lerp(actionHover, other.actionHover, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentMuted: Color.lerp(accentMuted, other.accentMuted, t)!,
      onAccent: Color.lerp(onAccent, other.onAccent, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      onDanger: Color.lerp(onDanger, other.onDanger, t)!,
      shadowOverlay: t < 0.5 ? shadowOverlay : other.shadowOverlay,
      shadowMenu: t < 0.5 ? shadowMenu : other.shadowMenu,
    );
  }
}

/// Read the tokens. `context.tokens` everywhere, never `Theme.of` by hand.
extension RudraThemeContext on BuildContext {
  RudraTokens get tokens => Theme.of(this).extension<RudraTokens>()!;
}

/// Build a full [ThemeData] from the tokens.
///
/// Material is the substrate, not the look: we set the surface colours and
/// typography from our own tokens so the app does not read as stock Material.
ThemeData buildRudraTheme(Brightness brightness) {
  final RudraTokens t = brightness == Brightness.dark
      ? RudraTokens.dark()
      : RudraTokens.light();

  final TextTheme text = _textTheme(t);

  return ThemeData(
    brightness: brightness,
    useMaterial3: true,
    extensions: <ThemeExtension<dynamic>>[t],
    // §13: body gets an explicit background, so no surface is ever undefined.
    scaffoldBackgroundColor: t.bgPrimary,
    canvasColor: t.bgPrimary,
    colorScheme: ColorScheme.fromSeed(
      seedColor: t.accent,
      brightness: brightness,
    ).copyWith(surface: t.bgPrimary, onSurface: t.textPrimary, error: t.danger),
    textTheme: text,
    dividerTheme: DividerThemeData(
      color: t.strokeTertiary,
      thickness: 1,
      space: 1,
    ),
    // Honour the platform's focus conventions but keep our own ring colour.
    focusColor: t.accent,
    hoverColor: t.actionHover,
    splashFactory: NoSplash.splashFactory,
    visualDensity: VisualDensity.standard,
  );
}

TextTheme _textTheme(RudraTokens t) {
  // One family for UI, one for code. Bundled system stacks for now; a licensed
  // face is a Phase 4 decision.
  const String ui = 'Inter';
  const List<String> uiFallback = <String>[
    'Segoe UI Variable',
    'Segoe UI',
    '.AppleSystemUIFont',
    'Cantarell',
    'sans-serif',
  ];

  TextStyle base(double size, FontWeight weight, Color color, double height) =>
      TextStyle(
        fontFamily: ui,
        fontFamilyFallback: uiFallback,
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height,
        // §9: comparable numbers line up. Cheap to apply globally.
        fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
      );

  return TextTheme(
    displaySmall: base(28, FontWeight.w600, t.textPrimary, 1.2),
    titleLarge: base(18, FontWeight.w600, t.textPrimary, 1.3),
    titleMedium: base(15, FontWeight.w600, t.textPrimary, 1.35),
    titleSmall: base(13, FontWeight.w600, t.textSecondary, 1.35),
    bodyLarge: base(15, FontWeight.w400, t.textPrimary, 1.55),
    bodyMedium: base(14, FontWeight.w400, t.textPrimary, 1.5),
    bodySmall: base(12.5, FontWeight.w400, t.textSecondary, 1.45),
    labelLarge: base(13.5, FontWeight.w500, t.textPrimary, 1.2),
    labelMedium: base(12, FontWeight.w500, t.textSecondary, 1.2),
    labelSmall: base(11, FontWeight.w500, t.textTertiary, 1.2),
  );
}

/// The monospace stack for code, logs and ids.
const TextStyle kMonoStyle = TextStyle(
  fontFamily: 'JetBrains Mono',
  fontFamilyFallback: <String>[
    'Cascadia Mono',
    'Consolas',
    'SF Mono',
    'Menlo',
    'DejaVu Sans Mono',
    'monospace',
  ],
  fontSize: 12.5,
  height: 1.5,
);

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rudra/ui/common/theme.dart';

/// Contrast enforcement.
///
/// docs/ui-guidelines.md §10: **MUST meet contrast**, and contrast must
/// increase on hover/press/focus, never decrease. A palette is easy to check
/// once by hand and easy to break silently afterwards, so it is checked here.
///
/// WCAG 2.1 relative luminance. APCA is the better model and the guideline
/// prefers it, but WCAG has an unambiguous pass line, which is what a test
/// needs. Treat these as a floor, not a ceiling.
double _linear(double channel) => channel <= 0.04045
    ? channel / 12.92
    : math.pow((channel + 0.055) / 1.055, 2.4).toDouble();

double _luminance(Color c) =>
    0.2126 * _linear(c.r) + 0.7152 * _linear(c.g) + 0.0722 * _linear(c.b);

double contrast(Color a, Color b) {
  final double la = _luminance(a);
  final double lb = _luminance(b);
  final double hi = math.max(la, lb);
  final double lo = math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  final Map<String, RudraTokens> themes = <String, RudraTokens>{
    'light': RudraTokens.light(),
    'dark': RudraTokens.dark(),
  };

  themes.forEach((String name, RudraTokens t) {
    group('$name theme contrast', () {
      void check(String label, Color fg, Color bg, double min) {
        test('$label >= $min:1', () {
          final double r = contrast(fg, bg);
          expect(
            r,
            greaterThanOrEqualTo(min),
            reason:
                '$label measured ${r.toStringAsFixed(2)}:1 '
                '(fg ${fg.toARGB32().toRadixString(16)}, '
                'bg ${bg.toARGB32().toRadixString(16)})',
          );
        });
      }

      // Body text: AAA, because a transcript is read for a long time.
      check('body on page', t.textPrimary, t.bgPrimary, 7);
      check('body on sidebar', t.textPrimary, t.bgSecondary, 7);
      check('body in composer', t.textPrimary, t.widgetSurface, 7);

      check('secondary text', t.textSecondary, t.bgPrimary, 4.5);
      check('tertiary text', t.textTertiary, t.bgPrimary, 3);

      check('accent on page', t.accent, t.bgPrimary, 3);
      check('accent on sidebar', t.accent, t.bgSecondary, 3);
      check('error text', t.danger, t.bgPrimary, 4.5);

      // The bug this file was written for: a white label on the dark theme's
      // light accent measures 2.35:1.
      check('label on primary fill', t.onAccent, t.accent, 4.5);
      check('label on danger fill', t.onDanger, t.danger, 4.5);

      test('the accent is in the blue family the cursors gave us', () {
        final HSLColor hsl = HSLColor.fromColor(t.accent);
        expect(
          hsl.hue,
          inInclusiveRange(195, 245),
          reason: 'accent hue ${hsl.hue} left the 213-222 family',
        );
        expect(hsl.saturation, greaterThan(0.5));
      });

      test('neutrals are tinted toward the accent hue, not pure grey', () {
        // §13: tint borders, shadows and secondary text toward the bg hue.
        final HSLColor bg = HSLColor.fromColor(t.bgSecondary);
        expect(
          bg.saturation,
          greaterThan(0.03),
          reason: 'bgSecondary is a flat grey; it should carry the blue tint',
        );
        expect(bg.hue, inInclusiveRange(190, 250));
      });
    });
  });

  test('the two themes are genuinely different, not one inverted', () {
    // An inverted palette produces matching hues at mirrored lightness. Ours
    // retunes the accent because a deep azure vanishes on a dark ground.
    final RudraTokens l = RudraTokens.light();
    final RudraTokens d = RudraTokens.dark();
    expect(l.accent, isNot(d.accent));
    expect(l.onAccent, isNot(d.onAccent));
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rudra/ui/common/theme.dart';
import 'package:rudra/ui/shell/app_shell.dart';

/// Layout checks at real window sizes.
///
/// docs/ui-guidelines.md §9 requires the shell to hold up at narrow (~900),
/// laptop and ultra-wide widths with no unwanted scrollbars and no overflow.
/// In a widget test a RenderFlex overflow throws, so `takeException` is a real
/// assertion rather than a formality.
///
/// These exist because a screenshot could not answer the question: a cropped
/// capture of a high-DPI window looks exactly like a clipped layout.
void main() {
  Future<void> pumpAt(WidgetTester tester, Size size) async {
    tester.view
      ..physicalSize = size
      ..devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: buildRudraTheme(Brightness.light),
          home: const AppShell(),
        ),
      ),
    );
    await tester.pump();
  }

  const Map<String, Size> sizes = <String, Size>{
    'narrow (900x700)': Size(900, 700),
    'laptop (1440x900)': Size(1440, 900),
    'tall (1280x1024)': Size(1280, 1024),
    'ultra-wide (2560x1080)': Size(2560, 1080),
  };

  sizes.forEach((String name, Size size) {
    testWidgets('lays out with no overflow at $name', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, size);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the composer is present and reachable at $name', (
      WidgetTester tester,
    ) async {
      // The regression this guards: a composer pushed off the bottom of the
      // window is indistinguishable from one that was never built.
      await pumpAt(tester, size);

      expect(find.byType(TextField), findsOneWidget);

      final Rect field = tester.getRect(find.byType(TextField));
      final Rect screen = Offset.zero & size;
      expect(
        screen.contains(field.center),
        isTrue,
        reason: 'composer centre $field is outside the $size window',
      );
      expect(field.width, greaterThan(100));
    });
  });

  testWidgets('the transcript is capped to a readable measure when wide', (
    WidgetTester tester,
  ) async {
    // §9: text never runs the full width of a 34" display.
    await pumpAt(tester, const Size(2560, 1080));

    final Rect field = tester.getRect(find.byType(TextField));
    expect(field.width, lessThanOrEqualTo(RudraTokens.transcriptMaxWidth));
  });

  testWidgets('the sidebar keeps its width as the window grows', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(2560, 1080));

    final Rect sidebar = tester.getRect(
      find
          .ancestor(
            of: find.text('New session'),
            matching: find.byType(SizedBox),
          )
          .first,
    );
    expect(sidebar.width, lessThanOrEqualTo(300));
  });
}

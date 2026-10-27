import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/ui/chat/message_notifier.dart';
import 'package:rudra/ui/common/theme.dart';
import 'package:rudra/ui/shell/app_shell.dart';

/// Does the shell reach a steady state, or does it schedule frames forever?
///
/// A view that re-schedules a post-frame callback on every frame never idles:
/// it pins a CPU core, drains a laptop battery, and makes `pumpAndSettle` hang.
void main() {
  testWidgets('a populated transcript settles', (WidgetTester tester) async {
    tester.view
      ..physicalSize = const Size(1280, 820)
      ..devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final ProviderContainer container = ProviderContainer();
    addTearDown(container.dispose);

    final DateTime now = DateTime.now();
    container.read(messagesProvider.notifier).state = <TranscriptMessage>[
      for (int i = 0; i < 12; i++)
        TranscriptMessage(
          id: 'm$i',
          author: i.isEven ? Author.user : Author.assistant,
          text:
              'TranscriptMessage number $i, long enough to take a line or two of room.',
          createdAt: now,
          completion: i.isEven ? null : const StreamCompletion.complete(),
        ),
    ];

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: buildRudraTheme(Brightness.light),
          home: const AppShell(),
        ),
      ),
    );

    await tester.pumpAndSettle(const Duration(milliseconds: 50));
    expect(tester.binding.hasScheduledFrame, isFalse);
  });
}

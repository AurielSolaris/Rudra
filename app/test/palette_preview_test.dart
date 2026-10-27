@Tags(<String>['preview'])
library;

import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/ui/chat/message_notifier.dart';
import 'package:rudra/ui/common/theme.dart';
import 'package:rudra/ui/shell/app_shell.dart';

/// Renders the shell offscreen and writes a PNG.
///
/// Not an assertion — a way to look at the UI without screen-scraping the
/// desktop (which captures whatever window happens to be in front).
///
///   bun run app:preview
void main() {
  for (final Brightness brightness in Brightness.values) {
    testWidgets('render ${brightness.name}', (WidgetTester tester) async {
      tester.view
        ..physicalSize = const Size(1280, 820)
        ..devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);

      // Seed a transcript so the preview shows real content, not the empty
      // state. A settled message needs no backend.
      final DateTime now = DateTime.now();
      container.read(messagesProvider.notifier).state = <Message>[
        Message(
          id: 'm1',
          author: Author.user,
          text: 'What does Rudra actually remember between sessions?',
          createdAt: now,
        ),
        Message(
          id: 'm2',
          author: Author.assistant,
          text:
              'Two curated files. MEMORY.md holds environment facts and '
              'lessons; USER.md holds who you are and how you like to be '
              'talked to. Both are injected into the system prompt once at '
              'session start and never mutated mid-conversation, because '
              'rewriting the prefix would invalidate the cache on every '
              'subsequent turn.',
          createdAt: now,
          completion: const StreamCompletion.complete(),
        ),
        Message(
          id: 'm3',
          author: Author.user,
          text: 'And if a reply gets cut off?',
          createdAt: now,
        ),
        Message(
          id: 'm4',
          author: Author.assistant,
          text:
              'It stays on screen, marked as stopped. A partial message is '
              'never presented as a finished one.',
          createdAt: now,
          completion: const StreamCompletion.interrupted(),
        ),
      ];

      // The root render object is not a repaint boundary, so supply one to
      // capture from.
      final GlobalKey frame = GlobalKey();

      await tester.pumpWidget(
        RepaintBoundary(
          key: frame,
          child: UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: buildRudraTheme(brightness),
              home: const AppShell(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle(const Duration(milliseconds: 300));

      final RenderRepaintBoundary boundary = tester
          .renderObject<RenderRepaintBoundary>(find.byKey(frame));

      // `toImage` needs real async: inside a widget test the fake clock
      // deadlocks it, so it has to run through `runAsync`.
      late final Uint8List png;
      await tester.runAsync(() async {
        final ui.Image image = await boundary.toImage();
        final ByteData? bytes = await image.toByteData(
          format: ui.ImageByteFormat.png,
        );
        image.dispose();
        png = bytes!.buffer.asUint8List();
      });

      final Directory out = Directory('build/preview')
        ..createSync(recursive: true);
      final File file = File('${out.path}/shell-${brightness.name}.png')
        ..writeAsBytesSync(png);
      // ignore: avoid_print
      print('wrote ${file.absolute.path}');
    });
  }
}

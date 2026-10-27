import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rudra/api/generated/models.dart';
import 'package:rudra/api/sse.dart';
import 'package:rudra/boot/handshake.dart';
import 'package:rudra/ui/chat/message_notifier.dart';
import 'package:rudra/ui/common/primitives.dart';
import 'package:rudra/ui/common/theme.dart';
import 'package:rudra/ui/shell/app_shell.dart';

/// Tests for the pieces that carry an invariant.
///
/// Deliberately not a snapshot of the whole UI: these cover handshake parsing,
/// SSE framing, and the streaming notifier — the three places where a silent
/// regression would be expensive.

void main() {
  group('Handshake.tryParse', () {
    const String validToken =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    String line({
      Object? rudra = 'handshake',
      Object? protocol = 1,
      Object? version = '0.0.0',
      Object? port = 51234,
      Object? token = validToken,
      Object? pid = 4242,
    }) => jsonEncode(<String, Object?>{
      'rudra': rudra,
      'protocol': protocol,
      'version': version,
      'port': port,
      'token': token,
      'pid': pid,
    });

    test('parses a well-formed line', () {
      final Handshake? h = Handshake.tryParse(line());
      expect(h, isNotNull);
      expect(h!.port, 51234);
      expect(h.token, validToken);
      expect(h.isProtocolCompatible, isTrue);
    });

    test('returns null instead of throwing on junk', () {
      // A boot failure is a state to render, not an exception to crash on.
      expect(Handshake.tryParse(''), isNull);
      expect(Handshake.tryParse('not json'), isNull);
      expect(Handshake.tryParse('{ broken'), isNull);
      expect(Handshake.tryParse('{"ok":true}'), isNull);
    });

    test('rejects a line that is not ours', () {
      expect(Handshake.tryParse(line(rudra: 'something-else')), isNull);
    });

    test('rejects a malformed port or token', () {
      expect(Handshake.tryParse(line(port: 0)), isNull);
      expect(Handshake.tryParse(line(port: 70000)), isNull);
      expect(Handshake.tryParse(line(port: '51234')), isNull);
      expect(Handshake.tryParse(line(token: 'too-short')), isNull);
    });

    test('flags an incompatible protocol rather than silently proceeding', () {
      final Handshake? h = Handshake.tryParse(line(protocol: 99));
      expect(h, isNotNull);
      expect(h!.isProtocolCompatible, isFalse);
    });

    test('never puts the token in toString', () {
      // Cheap insurance against a stray print leaking the credential.
      final Handshake h = Handshake.tryParse(line())!;
      expect(h.toString(), isNot(contains(validToken)));
    });

    test('resolves request URLs on loopback', () {
      final Handshake h = Handshake.tryParse(line())!;
      expect(h.resolve('/health').toString(), 'http://127.0.0.1:51234/health');
    });
  });

  group('parseSseEvents', () {
    Stream<List<int>> wire(List<String> chunks) =>
        Stream<List<int>>.fromIterable(chunks.map(utf8.encode));

    String frame(Map<String, Object?> data) =>
        'event: ${data['type']}\ndata: ${jsonEncode(data)}\n\n';

    test('decodes a full stream into typed events', () async {
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          frame(<String, Object?>{
            'type': 'start',
            'messageId': '01JABCDEFGHJKMNPQRSTVWXYZ0',
          }),
          frame(<String, Object?>{'type': 'delta', 'text': 'he'}),
          frame(<String, Object?>{'type': 'delta', 'text': 'llo'}),
          frame(<String, Object?>{
            'type': 'done',
            'reason': 'complete',
            'chars': 5,
          }),
        ]),
      ).toList();

      expect(events, hasLength(4));
      expect(events.first, isA<StreamStart>());
      expect(
        events.whereType<StreamDelta>().map((StreamDelta d) => d.text).join(),
        'hello',
      );
      expect(events.last, isA<StreamDone>());
    });

    test('reassembles frames split across chunk boundaries', () async {
      // The realistic case: a socket read lands mid-frame.
      final String whole =
          frame(<String, Object?>{'type': 'delta', 'text': 'abc'}) +
          frame(<String, Object?>{'type': 'delta', 'text': 'def'});
      final int cut = whole.length ~/ 3;

      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[whole.substring(0, cut), whole.substring(cut)]),
      ).toList();

      expect(
        events.whereType<StreamDelta>().map((StreamDelta d) => d.text).join(),
        'abcdef',
      );
    });

    test('accepts a final frame with no trailing blank line', () async {
      // The server may close immediately after the terminal event.
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          'event: done\ndata: '
              '${jsonEncode(<String, Object?>{'type': 'done', 'reason': 'complete', 'chars': 0})}',
        ]),
      ).toList();

      expect(events, hasLength(1));
      expect(events.single, isA<StreamDone>());
    });

    test('carries a typed error through', () async {
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          frame(<String, Object?>{
            'type': 'error',
            'error': <String, Object?>{
              'code': 'upstream',
              'message': 'Simulated upstream failure.',
            },
          }),
        ]),
      ).toList();

      final StreamError error = events.single as StreamError;
      expect(error.error.code, ErrorCode.upstream);
      expect(error.error.message, 'Simulated upstream failure.');
    });
  });

  group('StreamingMessage', () {
    test('accumulates deltas and notifies once per append', () {
      final StreamingMessage m = StreamingMessage(messageId: 'x');
      int notifications = 0;
      m.addListener(() => notifications++);

      m
        ..append('a')
        ..append('bc');

      expect(m.value, 'abc');
      expect(m.length, 3);
      expect(notifications, 2);
      m.dispose();
    });

    test('ignores an empty delta, so no wasted repaint', () {
      final StreamingMessage m = StreamingMessage(messageId: 'x');
      int notifications = 0;
      m.addListener(() => notifications++);

      m.append('');

      expect(notifications, 0);
      m.dispose();
    });

    test('keeps the first completion — a late cancel cannot overwrite it', () {
      // The terminal event is authoritative (PLAN.MD §7).
      final StreamingMessage m = StreamingMessage(messageId: 'x')
        ..append('partial')
        ..complete(const StreamCompletion.complete())
        ..complete(const StreamCompletion.interrupted());

      expect(m.completion?.reason, StreamEndReason.complete);
      expect(m.completion?.isPartial, isFalse);
      m.dispose();
    });

    test('marks an interrupted stream as partial', () {
      final StreamingMessage m = StreamingMessage(messageId: 'x')
        ..append('half')
        ..complete(const StreamCompletion.interrupted());

      expect(m.isComplete, isTrue);
      expect(m.completion!.isPartial, isTrue);
      m.dispose();
    });
  });

  group('theme', () {
    test('both brightnesses resolve every token', () {
      for (final Brightness b in Brightness.values) {
        final ThemeData theme = buildRudraTheme(b);
        final RudraTokens? tokens = theme.extension<RudraTokens>();
        expect(tokens, isNotNull, reason: 'tokens missing for $b');
        // §13: body always has an explicit background.
        expect(theme.scaffoldBackgroundColor, tokens!.bgPrimary);
      }
    });

    testWidgets('context.tokens reads the extension', (
      WidgetTester tester,
    ) async {
      late RudraTokens read;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildRudraTheme(Brightness.light),
          home: Builder(
            builder: (BuildContext context) {
              read = context.tokens;
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(read.accent, RudraTokens.light().accent);
    });
  });

  group('primitives', () {
    testWidgets('a busy button refuses to fire its callback', (
      WidgetTester tester,
    ) async {
      // §5: keep submit enabled until the request starts, then disable with a
      // spinner. A second tap mid-flight must not send twice.
      int taps = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildRudraTheme(Brightness.light),
          home: Scaffold(
            body: RudraButton(
              label: 'Send',
              busy: true,
              onPressed: () => taps++,
            ),
          ),
        ),
      );

      await tester.tap(find.text('Send'));
      await tester.pump();

      expect(taps, 0);
    });

    testWidgets('a busy button keeps its label', (WidgetTester tester) async {
      // §5: show a spinner, never swap the label for "Loading…".
      await tester.pumpWidget(
        MaterialApp(
          theme: buildRudraTheme(Brightness.light),
          home: Scaffold(
            body: RudraButton(label: 'Send', busy: true, onPressed: () {}),
          ),
        ),
      );
      expect(find.text('Send'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('the loader never renders the words "Loading…"', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildRudraTheme(Brightness.light),
          home: const Scaffold(body: Loader()),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.textContaining('Loading'), findsNothing);
    });

    testWidgets('an error state always offers a next step', (
      WidgetTester tester,
    ) async {
      // §7: no dead ends.
      await tester.pumpWidget(
        MaterialApp(
          theme: buildRudraTheme(Brightness.light),
          home: Scaffold(
            body: ErrorState(
              title: 'It broke',
              detail: 'because of reasons',
              actionLabel: 'Try again',
              onAction: () {},
            ),
          ),
        ),
      );
      expect(find.text('It broke'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('shell composition', () {
    // REGRESSION: the shell rendered a red "No Material widget found" screen
    // because AppShell sat directly on MaterialApp.home with no Scaffold, and
    // TextField requires a Material ancestor.
    //
    // Every other widget test wrapped its subject in its own Scaffold, so the
    // one composition that ships was the one never pumped. This test supplies
    // NO Scaffold on purpose — the surface must stand up by itself.
    testWidgets('AppShell renders without a Scaffold supplied by the caller', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: buildRudraTheme(Brightness.light),
            home: const AppShell(),
          ),
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull);
      // The composer's input is the widget that demanded Material.
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('AppShell provides its own Material ancestor', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: buildRudraTheme(Brightness.light),
            home: const AppShell(),
          ),
        ),
      );

      expect(
        find.ancestor(
          of: find.byType(TextField),
          matching: find.byType(Material),
        ),
        findsWidgets,
      );
    });

    testWidgets('the empty transcript shows its designed empty state', (
      WidgetTester tester,
    ) async {
      // §7: every surface designs its empty state.
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: buildRudraTheme(Brightness.light),
            home: const AppShell(),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Nothing here yet'), findsOneWidget);
    });
  });
}

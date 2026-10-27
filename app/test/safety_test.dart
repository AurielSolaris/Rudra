import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rudra/api/generated/models.dart';
import 'package:rudra/api/sse.dart';
import 'package:rudra/boot/handshake.dart';
import 'package:rudra/core/bounded.dart';
import 'package:rudra/core/limits.dart';
import 'package:rudra/state/message_store.dart';
import 'package:rudra/ui/chat/message_notifier.dart';

/// Tests for the two properties that are not visible in a screenshot:
/// **nothing grows without a ceiling**, and **wrong data fails by a designed
/// route instead of crashing**.
///
/// Every test here is written as an *attack*: feed the thing the input that
/// would break it, and assert it degrades the way it was designed to. A test
/// that only checks the happy path cannot tell a bound that works from a bound
/// that was never wired up.
void main() {
  group('limits do not drift from the TypeScript source', () {
    // The Dart constants in core/limits.dart mirror packages/shared/src/limits.ts
    // by hand, because they are read on the hot path. This test is the only
    // reason that duplication is safe: it parses the real TypeScript and fails
    // the build if the two ever disagree.
    late final Map<String, int> fromTypeScript;

    setUpAll(() {
      final File source = File('../packages/shared/src/limits.ts');
      expect(
        source.existsSync(),
        isTrue,
        reason:
            'Could not find ${source.absolute.path}. This test must run from '
            'the app/ directory, which is where `flutter test` runs it.',
      );

      // Matches `export const NAME = <arithmetic>;` and evaluates the simple
      // `a * b` products the source uses, so 1024 * 1024 is compared as a
      // number rather than as text.
      final RegExp decl = RegExp(
        r'export const ([A-Z0-9_]+) = ([0-9*\s]+);',
        multiLine: true,
      );
      fromTypeScript = <String, int>{
        for (final RegExpMatch m in decl.allMatches(source.readAsStringSync()))
          m.group(1)!: m
              .group(2)!
              .split('*')
              .map((String p) => int.parse(p.trim()))
              .reduce((int a, int b) => a * b),
      };
      expect(
        fromTypeScript,
        isNotEmpty,
        reason: 'Parsed no constants — has the shape of limits.ts changed?',
      );
    });

    void matches(String tsName, int dartValue) {
      test(tsName, () {
        expect(
          fromTypeScript[tsName],
          isNotNull,
          reason:
              '$tsName is missing from packages/shared/src/limits.ts. If it '
              'was renamed, rename it in core/limits.dart too.',
        );
        expect(
          dartValue,
          fromTypeScript[tsName],
          reason:
              'core/limits.dart disagrees with limits.ts about $tsName. '
              'The TypeScript file is the source of truth.',
        );
      });
    }

    matches('MAX_SSE_FRAME_BYTES', Limits.maxSseFrameBytes);
    matches('MAX_MESSAGE_CHARS', Limits.maxMessageChars);
    matches('MAX_TRANSCRIPT_MESSAGES', Limits.maxTranscriptMessages);
    matches('MAX_ERROR_BODY_BYTES', Limits.maxErrorBodyBytes);
    matches('MAX_HANDSHAKE_LINE_CHARS', Limits.maxHandshakeLineChars);
    matches('MAX_LOG_LINE_CHARS', Limits.maxLogLineChars);
    matches('MAX_LOG_LINES', Limits.maxLogLines);
  });

  group('SSE parsing is bounded', () {
    Stream<List<int>> wire(Iterable<String> chunks) =>
        Stream<List<int>>.fromIterable(chunks.map(utf8.encode));

    test('a peer that never sends a frame boundary is cut off', () async {
      // The OOM case: an endless `data:` line with no blank line after it. The
      // old parser re-materialised the whole accumulation on every chunk and
      // kept it forever.
      const int chunk = 64 * 1024;
      final Iterable<String> endless = Iterable<String>.generate(
        (Limits.maxSseFrameBytes ~/ chunk) + 2,
        (_) => 'x' * chunk,
      );

      final List<StreamEvent> events = await parseSseEvents(
        wire(endless),
      ).toList();

      // It terminates, and it says why, rather than growing until the app dies.
      expect(events, hasLength(1));
      final StreamError error = events.single as StreamError;
      expect(error.error.code, ErrorCode.internal);
      expect(error.error.message, contains('malformed response stream'));
    });

    test('a legitimate frame just under the cap still parses', () async {
      // The bound must not be so eager that it rejects real traffic. A delta
      // close to the ceiling is unusual but valid.
      final String big = 'y' * (Limits.maxSseFrameBytes ~/ 2);
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          'event: delta\ndata: '
              '${jsonEncode(<String, Object?>{'type': 'delta', 'text': big})}\n\n',
        ]),
      ).toList();

      expect(events, hasLength(1));
      expect((events.single as StreamDelta).text.length, big.length);
    });

    test('malformed JSON terminates the stream instead of throwing', () async {
      // Before: jsonDecode threw out of an async* body and surfaced as an
      // unhandled stream error. Now it leaves by the same door as a
      // server-sent error, which is why the UI needs only one error path.
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>['event: delta\ndata: {not json at all\n\n']),
      ).toList();

      final StreamError error = events.single as StreamError;
      expect(error.error.message, contains('could not be parsed'));
    });

    test('a field of the wrong type names the field', () async {
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          'event: delta\n'
              'data: ${jsonEncode(<String, Object?>{'type': 'delta', 'text': 42})}\n\n',
        ]),
      ).toList();

      final StreamError error = events.single as StreamError;
      expect(error.error.message, contains("'text'"));
      expect(error.error.message, contains('a string'));
    });

    test('an event type this build does not know is reported', () async {
      // The version-skew case: a backend one release ahead. It must not be
      // silently skipped, or a truncated stream would look complete.
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          'event: tool\ndata: ${jsonEncode(<String, Object?>{'type': 'tool'})}\n\n',
        ]),
      ).toList();

      final StreamError error = events.single as StreamError;
      expect(error.error.message, contains('could not read'));
    });

    test('an out-of-contract `reason` is rejected, not defaulted', () async {
      // `reason` is a closed set. Accepting an unknown value and mapping it to
      // `complete` would report a cut stream as a finished one.
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          'event: done\ndata: '
              '${jsonEncode(<String, Object?>{'type': 'done', 'reason': 'vibes', 'chars': 3})}\n\n',
        ]),
      ).toList();

      expect(events.single, isA<StreamError>());
    });

    test('a boundary split across two chunks is still found', () async {
      // Guards the scan-resume optimisation: the scan starts 3 characters back
      // into the previous carry, so a '\n\n' straddling a chunk edge is seen.
      final List<StreamEvent> events = await parseSseEvents(
        wire(<String>[
          'event: delta\ndata: {"type":"delta","text":"a"}\n',
          '\nevent: delta\ndata: {"type":"delta","text":"b"}\n\n',
        ]),
      ).toList();

      expect(
        events.whereType<StreamDelta>().map((StreamDelta d) => d.text).join(),
        'ab',
      );
    });
  });

  group('lists of contract objects decode and encode', () {
    // The generator used to emit `_reqTypedList<Session>` for these, whose
    // `is T` test is false for every element because elements arrive as plain
    // maps — so a perfectly good payload threw. It was silent until a route
    // actually returned a list, which is to say until Phase 1. These lock the
    // round trip in both directions.
    Map<String, dynamic> session(String id, String? title) => <String, dynamic>{
      'id': id,
      // Null-aware element: omits the entry entirely when title is null, which
      // is what an absent optional looks like on the wire.
      'title': ?title,
      'state': 'active',
      'createdAt': 1700000000000,
      'updatedAt': 1700000000001,
      'provider': 'local',
      'model': 'test-model',
      'messageCount': 2,
      'tokensIn': 10,
      'tokensOut': 20,
    };

    test('a list of nested objects decodes element by element', () {
      final SessionList list = SessionList.fromJson(<String, dynamic>{
        'sessions': <dynamic>[
          session('01J0000000000000000000000A', 'first'),
          session('01J0000000000000000000000B', null),
        ],
      });

      expect(list.sessions, hasLength(2));
      expect(list.sessions[0].title, 'first');
      expect(list.sessions[1].title, isNull);
      expect(list.sessions[0].state, SessionState.active);
      expect(list.nextCursor, isNull);
    });

    test('a bad element names its index, not just the list', () {
      // "one of these is wrong" is not actionable; the index is.
      expect(
        () => SessionList.fromJson(<String, dynamic>{
          'sessions': <dynamic>[session('01J0000000000000000000000A', null), 7],
        }),
        throwsA(
          isA<WireTypeError>().having(
            (WireTypeError e) => e.message,
            'message',
            contains('sessions[1]'),
          ),
        ),
      );
    });

    test('toJson produces encodable JSON, not a list of Dart objects', () {
      // The real bug this guards: `jsonEncode` on a List<Session> throws at the
      // call site, far from the generated code that caused it.
      final SessionList list = SessionList.fromJson(<String, dynamic>{
        'sessions': <dynamic>[session('01J0000000000000000000000A', 'kept')],
      });

      final String encoded = jsonEncode(list.toJson());
      final Map<String, dynamic> back =
          jsonDecode(encoded) as Map<String, dynamic>;

      expect(SessionList.fromJson(back).sessions[0].title, 'kept');
    });
  });

  group('typed readers reject wrong data', () {
    test('an integer field accepts 5.0 but not 5.5', () {
      // JSON has one number type, so a whole number may arrive as a double.
      // That is ambiguity to absorb. A fractional value is a contract break.
      Map<String, dynamic> health(Object? protocol) => <String, dynamic>{
        'ok': true,
        'version': '0.0.0',
        'uptime': 1.5,
        'protocol': protocol,
      };

      expect(HealthResponse.fromJson(health(1)).protocol, 1);
      expect(HealthResponse.fromJson(health(1.0)).protocol, 1);
      expect(
        () => HealthResponse.fromJson(health(1.5)),
        throwsA(isA<WireTypeError>()),
      );
    });

    test('a numeric string is never coerced to a number', () {
      // Coercion here would hide a real break: the backend sent the wrong type.
      expect(
        () => HealthResponse.fromJson(const <String, dynamic>{
          'ok': true,
          'version': '0.0.0',
          'uptime': 1.0,
          'protocol': '1',
        }),
        throwsA(isA<WireTypeError>()),
      );
    });

    test('a missing required field says which one', () {
      try {
        HealthResponse.fromJson(const <String, dynamic>{
          'ok': true,
          'version': '0.0.0',
          'uptime': 1.0,
        });
        fail('expected a WireTypeError');
      } on WireTypeError catch (e) {
        expect(e.message, contains("'protocol'"));
        expect(e.message, contains('absent'));
      }
    });

    test('an unknown enum member can be tried without throwing', () {
      // `fromWire` is strict so a mismatch is never silently mapped onto the
      // wrong member; `tryFromWire` is the escape hatch for callers that would
      // rather degrade than fail.
      expect(ErrorCode.tryFromWire('from_the_future'), isNull);
      expect(ErrorCode.tryFromWire('upstream'), ErrorCode.upstream);
      expect(
        () => ErrorCode.fromWire('from_the_future'),
        throwsA(isA<WireTypeError>()),
      );
    });

    test('a nested object is checked one level down', () {
      expect(
        () => StreamError.fromJson(const <String, dynamic>{
          'type': 'error',
          'error': <String, dynamic>{'code': 'upstream', 'message': 7},
        }),
        throwsA(isA<WireTypeError>()),
      );
    });

    test('NaN and infinity are not accepted as numbers', () {
      // These cannot come from jsonDecode, but they can come from a hand-built
      // map, and a non-finite value propagates into layout as a crash.
      expect(
        () => HealthResponse.fromJson(const <String, dynamic>{
          'ok': true,
          'version': '0.0.0',
          'uptime': double.infinity,
          'protocol': 1,
        }),
        throwsA(isA<WireTypeError>()),
      );
    });
  });

  group('a streaming message is bounded', () {
    test('it stops at the cap and completes with reason length', () {
      // A provider that never emits a terminal event is a real failure mode: a
      // broken stop sequence does it. Unbounded, this is an OOM.
      final StreamingMessage m = StreamingMessage(messageId: 'x');
      const String chunk = 'abcdefghij';
      for (int i = 0; i < (Limits.maxMessageChars ~/ chunk.length) + 50; i++) {
        m.append(chunk);
      }

      expect(m.length, Limits.maxMessageChars);
      expect(m.completion?.reason, StreamEndReason.length);
      // `length` is already a designed partial state, so the cap degrades into
      // an outcome the UI renders rather than an error it has to handle.
      expect(m.completion!.isPartial, isTrue);
      m.dispose();
    });

    test('a delta that would overshoot is truncated, not dropped', () {
      final StreamingMessage m = StreamingMessage(messageId: 'x')
        ..append('a' * (Limits.maxMessageChars - 5))
        ..append('bbbbbbbbbb');

      expect(m.length, Limits.maxMessageChars);
      expect(m.value.endsWith('bbbbb'), isTrue);
      m.dispose();
    });

    test('truncation never splits a surrogate pair', () {
      // Cutting mid-pair leaves an unpaired half, which renders as a
      // replacement character — a visible corruption at exactly the moment the
      // user is already seeing a truncated reply.
      const String emoji = '🔥'; // one rune, two UTF-16 code units
      final StreamingMessage m = StreamingMessage(messageId: 'x')
        ..append('a' * (Limits.maxMessageChars - 1))
        ..append(emoji);

      expect(m.length, Limits.maxMessageChars - 1);
      expect(m.value.codeUnits.last, 'a'.codeUnitAt(0));
      // Decoding the result must not produce a replacement character.
      expect(m.value.runes.last, 'a'.runes.first);
      m.dispose();
    });

    test('a delta arriving after the terminal event is ignored', () {
      // The terminal event is authoritative (PLAN.MD §7), so a late delta
      // cannot extend a settled message.
      final StreamingMessage m = StreamingMessage(messageId: 'x')
        ..append('done')
        ..complete(const StreamCompletion.complete())
        ..append(' and more');

      expect(m.value, 'done');
      m.dispose();
    });
  });

  group('line splitting is bounded', () {
    Stream<String> chars(Iterable<String> chunks) =>
        Stream<String>.fromIterable(chunks);

    test('a newline-free torrent is emitted in capped pieces', () async {
      // LineSplitter would buffer this forever. The sidecar is a subprocess
      // whose output we do not control, so this is an input, not a hypothetical.
      final List<String> lines = await boundedLines(
        chars(Iterable<String>.generate(20, (_) => 'z' * 1000)),
        maxLineChars: 100,
      ).toList();

      expect(lines, hasLength(200));
      expect(lines.every((String l) => l.length <= 100), isTrue);
      // Nothing is dropped: a long line becomes several.
      expect(lines.join().length, 20 * 1000);
    });

    test('normal lines survive, and CRLF does not leave a stray CR', () async {
      final List<String> lines = await boundedLines(
        chars(<String>['one\r\ntw', 'o\nthree\n']),
      ).toList();

      expect(lines, const <String>['one', 'two', 'three']);
    });

    test('a trailing line with no newline is still emitted', () async {
      final List<String> lines = await boundedLines(
        chars(<String>['first\nlast, unterminated']),
      ).toList();

      expect(lines, const <String>['first', 'last, unterminated']);
    });
  });

  group('error bodies are read with a ceiling', () {
    test('it stops at the cap instead of buffering what it is sent', () async {
      final Stream<List<int>> flood = Stream<List<int>>.fromIterable(
        Iterable<List<int>>.generate(
          64,
          (_) => List<int>.filled(16 * 1024, 0x41),
        ),
      );

      final String body = await readCapped(flood);

      expect(body.length, Limits.maxErrorBodyBytes);
    });

    test('a short body is returned whole', () async {
      final String body = await readCapped(
        Stream<List<int>>.fromIterable(<List<int>>[utf8.encode('{"a":1}')]),
      );
      expect(body, '{"a":1}');
    });

    test('a body truncated mid-sequence still decodes', () async {
      // Lenient on purpose: the result is only used to build a message for a
      // person, and throwing here would replace a reportable failure with a
      // crash in the error path itself.
      final String body = await readCapped(
        Stream<List<int>>.fromIterable(const <List<int>>[
          <int>[0xF0, 0x9F],
        ]),
      );
      expect(body, isNotEmpty);
    });
  });

  group('the handshake is bounded before it is parsed', () {
    test('an absurdly long line is refused without decoding', () {
      final String huge =
          '{"rudra":"handshake","pad":"'
          '${'p' * (Limits.maxHandshakeLineChars + 10)}"}';

      expect(Handshake.tryParse(huge), isNull);
    });

    test('a real handshake is comfortably under the ceiling', () {
      // The guard is only safe if it cannot reject real traffic.
      final String real = jsonEncode(<String, Object?>{
        'rudra': 'handshake',
        'protocol': 1,
        'version': '0.0.0',
        'port': 51234,
        'token': '0' * 64,
        'pid': 4242,
      });

      expect(real.length, lessThan(Limits.maxHandshakeLineChars ~/ 4));
      expect(Handshake.tryParse(real), isNotNull);
    });
  });

  group('the transcript is bounded', () {
    TranscriptMessage filler(int i) => TranscriptMessage(
      id: 'm$i',
      author: Author.user,
      text: 'message $i',
      createdAt: DateTime.fromMillisecondsSinceEpoch(i),
    );

    test('it holds at the cap and drops from the front', () {
      // Phase 0 keeps the transcript in memory, so this is a hard RAM bound:
      // with the per-message cap it puts a ceiling on a session's worst case.
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);
      final MessageStore store = container.read(messagesProvider.notifier);

      store.appendForTest(
        Iterable<TranscriptMessage>.generate(
          Limits.maxTranscriptMessages + 500,
          filler,
        ),
      );

      expect(
        container.read(messagesProvider),
        hasLength(Limits.maxTranscriptMessages),
      );
      expect(store.droppedCount, 500);
      // The newest messages are the ones kept: a transcript trims its history,
      // never its present.
      expect(
        container.read(messagesProvider).last.id,
        'm${Limits.maxTranscriptMessages + 499}',
      );
    });

    test('the number dropped is reported rather than hidden', () {
      // §7: that the transcript was trimmed is a fact about what the user is
      // looking at, so it is observable instead of silent.
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);
      final MessageStore store = container.read(messagesProvider.notifier);

      expect(store.droppedCount, 0);
      store.appendForTest(
        Iterable<TranscriptMessage>.generate(
          Limits.maxTranscriptMessages + 1,
          filler,
        ),
      );
      expect(store.droppedCount, 1);

      // A new session starts the tally over.
      store.clear();
      expect(store.droppedCount, 0);
      expect(container.read(messagesProvider), isEmpty);
    });

    test('staying under the cap keeps every message', () {
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);
      final MessageStore store = container.read(messagesProvider.notifier);

      store.appendForTest(Iterable<TranscriptMessage>.generate(10, filler));

      expect(container.read(messagesProvider), hasLength(10));
      expect(store.droppedCount, 0);
    });
  });
}

@Tags(<String>['spine'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rudra/api/client.dart';
import 'package:rudra/api/generated/models.dart';
import 'package:rudra/boot/handshake.dart';
import 'package:rudra/boot/sidecar_process.dart';

/// End-to-end: Dart spawns the real sidecar and streams through it.
///
/// The other tests mock nothing but also touch nothing real. This one proves
/// the actual path the app uses — spawn, handshake, bearer auth, SSE — from the
/// Dart side, which is the half `bun run smoke` cannot reach.
///
/// Skipped automatically when `bun` is not on PATH.
void main() {
  late SidecarProcess sidecar;
  late Handshake handshake;
  late RudraClient client;

  setUpAll(() async {
    sidecar = SidecarProcess(bootTimeout: const Duration(seconds: 45));
    handshake = await sidecar.start();
    client = RudraClient(handshake: handshake);
  });

  tearDownAll(() async {
    client.close();
    await sidecar.stop();
  });

  test('the sidecar hands back a usable handshake', () {
    expect(handshake.port, greaterThan(1024));
    expect(handshake.token, hasLength(64));
    expect(handshake.isProtocolCompatible, isTrue);
  });

  test('health reports ready', () async {
    final HealthResponse health = await client.health();
    expect(health.ok, isTrue);
    expect(health.protocol, Handshake.expectedProtocol);
  });

  test('a stream reassembles to exactly what was sent', () async {
    const String message = 'The precursor, not the aspect.';

    final List<StreamEvent> events = await client
        .echo(message, delayMs: 0)
        .toList();

    expect(events.first, isA<StreamStart>());
    expect(
      events.whereType<StreamDelta>().map((StreamDelta d) => d.text).join(),
      message,
    );

    final StreamDone done = events.last as StreamDone;
    expect(done.reason, 'complete');
    expect(done.chars, message.length);
  });

  test('a failure arrives as a terminal error, keeping prior text', () async {
    final List<StreamEvent> events = await client
        .echo('abcdefghijklmnop', delayMs: 0, failAfter: 8)
        .toList();

    expect(events.last, isA<StreamError>());
    expect((events.last as StreamError).error.code, ErrorCode.upstream);
    expect(
      events.whereType<StreamDelta>().map((StreamDelta d) => d.text).join(),
      'abcdefgh',
    );
  });

  test('cancelling the stream mid-flight stops it', () async {
    // This is how interrupt reaches the backend: the subscription is cancelled,
    // the HTTP response closes, and the server sees a client disconnect.
    final Stream<StreamEvent> stream = client.echo(
      'a long message that will not finish streaming before we cancel it',
      delayMs: 30,
    );

    final List<StreamEvent> seen = <StreamEvent>[];
    final Object sub = stream.listen(seen.add);
    await Future<void>.delayed(const Duration(milliseconds: 150));
    await (sub as dynamic).cancel();

    expect(seen, isNotEmpty);
    expect(seen.whereType<StreamDone>(), isEmpty);
  });

  test('an unauthenticated request is refused', () async {
    // PLAN.MD §8 — the token is the only thing between a web page and shell
    // access, so assert it from the client side too.
    final RudraClient bogus = RudraClient(
      handshake: Handshake(
        protocol: handshake.protocol,
        version: handshake.version,
        port: handshake.port,
        token: '0' * 64,
        pid: handshake.pid,
      ),
    );
    addTearDown(bogus.close);

    await expectLater(
      bogus.health(),
      throwsA(
        isA<ApiException>().having(
          (ApiException e) => e.error.code,
          'code',
          ErrorCode.unauthorized,
        ),
      ),
    );
  });
}

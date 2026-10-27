import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:rudra/api/generated/models.dart';
import 'package:rudra/api/sse.dart';
import 'package:rudra/boot/handshake.dart';
import 'package:rudra/core/bounded.dart';

/// Talks to the sidecar.
///
/// Every request carries the session token from the handshake (PLAN.MD §8).
/// Widgets never construct requests themselves — they go through a provider,
/// which goes through here (docs/ui-guidelines.md §12).
class RudraClient {
  RudraClient({required this.handshake, http.Client? inner})
    : _inner = inner ?? http.Client();

  final Handshake handshake;
  final http.Client _inner;

  Map<String, String> get _authHeaders => <String, String>{
    'authorization': 'Bearer ${handshake.token}',
  };

  /// GET /health. The boot sequence polls this to confirm it is really serving.
  Future<HealthResponse> health() async {
    final http.Response response = await _inner.get(
      handshake.resolve('/health'),
      headers: _authHeaders,
    );
    if (response.statusCode != 200) {
      throw ApiException.fromResponse(response);
    }
    // Wrong data is a reportable failure, not a crash: a backend that answers
    // /health with something off-contract fails the boot gate with a message
    // naming the field, instead of throwing a bare TypeError out of boot().
    try {
      final Object? decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) {
        throw const WireTypeError('the health response was not a JSON object');
      }
      return HealthResponse.fromJson(decoded);
    } on FormatException catch (e) {
      throw ApiException(
        statusCode: response.statusCode,
        error: ApiError(
          code: ErrorCode.internal,
          message:
              'The backend sent an unreadable health response: ${e.message}',
        ),
      );
    } on WireTypeError catch (e) {
      throw ApiException(
        statusCode: response.statusCode,
        error: ApiError(
          code: ErrorCode.internal,
          message:
              'The backend health response did not match the contract: ${e.message}',
        ),
      );
    }
  }

  /// POST /chat/echo — the Phase 0 spine.
  ///
  /// Returns the SSE event stream. Phase 1 replaces this with a real provider
  /// call; the event union and everything downstream of it stay identical.
  Stream<StreamEvent> echo(String message, {int delayMs = 15, int? failAfter}) {
    final Map<String, Object?> payload = <String, Object?>{
      'message': message,
      'delayMs': delayMs,
    };
    if (failAfter != null) payload['failAfter'] = failAfter;

    final http.Request request =
        http.Request('POST', handshake.resolve('/chat/echo'))
          ..headers.addAll(<String, String>{
            ..._authHeaders,
            'content-type': 'application/json',
            'accept': 'text/event-stream',
          })
          ..body = jsonEncode(payload);

    return _stream(request);
  }

  Stream<StreamEvent> _stream(http.Request request) async* {
    final http.StreamedResponse response = await _inner.send(request);

    if (response.statusCode != 200) {
      throw ApiException.fromBody(
        response.statusCode,
        await readCapped(response.stream),
      );
    }

    yield* parseSseEvents(response.stream);
  }

  void close() => _inner.close();
}

/// A failed request, carrying the server's own error shape when it sent one.
class ApiException implements Exception {
  const ApiException({required this.statusCode, required this.error});

  factory ApiException.fromResponse(http.Response response) =>
      ApiException.fromBody(response.statusCode, response.body);

  factory ApiException.fromBody(int statusCode, String body) {
    try {
      final Object? decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        return ApiException(
          statusCode: statusCode,
          error: ApiError.fromJson(decoded),
        );
      }
    } on FormatException {
      // Not JSON. Fall through to the generic error below.
    } on WireTypeError {
      // JSON, but not our error shape. Same treatment: the status code is
      // still meaningful even when the body is not.
    }
    return ApiException(
      statusCode: statusCode,
      error: ApiError(
        code: statusCode == 401 ? ErrorCode.unauthorized : ErrorCode.internal,
        message: 'Request failed with status $statusCode.',
      ),
    );
  }

  final int statusCode;
  final ApiError error;

  @override
  String toString() => error.message;
}

// GENERATED FILE — DO NOT EDIT.
//
// Source: packages/contracts/src/*.ts  (TypeBox schemas, listed in SCHEMAS)
// Regenerate: bun run codegen
// Verify:     bun run codegen:check   <- CI runs this; drift fails the build.
//
// Hand-editing this file is the drift PLAN.MD §3 exists to prevent.

// ignore_for_file: prefer_single_quotes, unnecessary_this, lines_longer_than_80_chars
// ignore_for_file: sort_constructors_first, always_put_required_named_parameters_first
// Which typed readers are used depends on which contracts exist, so some of
// them are legitimately unreferenced in any given generation.
// ignore_for_file: unused_element


import 'package:meta/meta.dart';


/// Thrown when wire data does not match the contract this file was generated
/// from.
///
/// Distinct from [FormatException] on purpose: a FormatException means the bytes
/// were not JSON, while this means the JSON was well-formed but disagreed with
/// the contract — a version skew between app and backend, not a corrupt socket.
@immutable
class WireTypeError implements Exception {
  const WireTypeError(this.message);

  /// Names the offending field and what was expected. Safe to show a person.
  final String message;

  @override
  String toString() => 'WireTypeError: $message';
}

Never _bad(String field, String expected, Object? got) => throw WireTypeError(
      "field '$field' should be $expected, but was ${got == null ? 'absent' : got.runtimeType}",
    );

String _reqStr(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is String) return v;
  return _bad(f, 'a string', v);
}

String? _optStr(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is String) return v;
  return _bad(f, 'a string or absent', v);
}

bool _reqBool(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is bool) return v;
  return _bad(f, 'a boolean', v);
}

bool? _optBool(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is bool) return v;
  return _bad(f, 'a boolean or absent', v);
}

/// JSON has a single number type, so an integer field may legitimately arrive
/// as `5.0`. A fractional value is still a contract break and is rejected.
int _reqInt(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is int) return v;
  if (v is num && v == v.roundToDouble() && v.isFinite) return v.toInt();
  return _bad(f, 'an integer', v);
}

int? _optInt(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is int) return v;
  if (v is num && v == v.roundToDouble() && v.isFinite) return v.toInt();
  return _bad(f, 'an integer or absent', v);
}

double _reqNum(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is num && v.isFinite) return v.toDouble();
  return _bad(f, 'a finite number', v);
}

double? _optNum(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is num && v.isFinite) return v.toDouble();
  return _bad(f, 'a finite number or absent', v);
}

Map<String, dynamic> _reqMap(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is Map) return Map<String, dynamic>.from(v);
  return _bad(f, 'an object', v);
}

Map<String, dynamic>? _optMap(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is Map) return Map<String, dynamic>.from(v);
  return _bad(f, 'an object or absent', v);
}

List<dynamic> _reqList(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is List) return v;
  return _bad(f, 'an array', v);
}

List<dynamic>? _optList(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is List) return v;
  return _bad(f, 'an array or absent', v);
}

/// Element reader for a typed list. The index is part of the message, because
/// "one of 400 items was wrong" is not actionable on its own.
T _item<T>(List<dynamic> list, int index, String field) {
  final v = list[index];
  if (v is T) return v;
  return _bad('$field[$index]', '$T', v);
}

List<T> _reqTypedList<T>(Map<String, dynamic> j, String f) {
  final raw = _reqList(j, f);
  return List<T>.generate(raw.length, (i) => _item<T>(raw, i, f));
}

/// Reader for an inline string union — a set of literals the contract spells
/// out without naming, so no Dart enum is emitted for it.
///
/// It still validates membership. Without this the field is "some string", and
/// a caller switching on it needs a default case that can only guess.
String _reqOneOf(Map<String, dynamic> j, String f, List<String> allowed) {
  final v = _reqStr(j, f);
  if (allowed.contains(v)) return v;
  return _bad(f, 'one of ${allowed.join(', ')}', v);
}

String? _optOneOf(Map<String, dynamic> j, String f, List<String> allowed) {
  final v = _optStr(j, f);
  if (v == null || allowed.contains(v)) return v;
  return _bad(f, 'one of ${allowed.join(', ')} or absent', v);
}

List<T>? _optTypedList<T>(Map<String, dynamic> j, String f) {
  final raw = _optList(j, f);
  if (raw == null) return null;
  return List<T>.generate(raw.length, (i) => _item<T>(raw, i, f));
}

/// Reader for a list of nested contract objects.
///
/// [_reqTypedList] cannot do this job: its elements arrive as
/// `Map<String, dynamic>`, so an `is T` test against a generated class is
/// false for every element and the whole list fails. Each element is decoded
/// through its own `fromJson`, which applies the same discipline one level down.
List<T> _reqObjList<T>(
  Map<String, dynamic> j,
  String f,
  T Function(Map<String, dynamic>) fromJson,
) {
  final raw = _reqList(j, f);
  return List<T>.generate(raw.length, (i) {
    final v = raw[i];
    if (v is Map) return fromJson(Map<String, dynamic>.from(v));
    return _bad('$f[$i]', 'an object', v);
  });
}

List<T>? _optObjList<T>(
  Map<String, dynamic> j,
  String f,
  T Function(Map<String, dynamic>) fromJson,
) {
  if (j[f] == null) return null;
  return _reqObjList<T>(j, f, fromJson);
}

/// Reader for a list of enum members, decoded through the enum's own wire map.
List<T> _reqEnumList<T>(Map<String, dynamic> j, String f, T Function(String) fromWire) {
  final raw = _reqList(j, f);
  return List<T>.generate(raw.length, (i) {
    final v = raw[i];
    if (v is String) return fromWire(v);
    return _bad('$f[$i]', 'a string', v);
  });
}

List<T>? _optEnumList<T>(Map<String, dynamic> j, String f, T Function(String) fromWire) {
  if (j[f] == null) return null;
  return _reqEnumList<T>(j, f, fromWire);
}


// Id: scalar alias (string), no class emitted.

/// Stable failure codes the UI may branch on.
enum ErrorCode {
  invalid('invalid'),
  unauthorized('unauthorized'),
  notFound('not_found'),
  forbidden('forbidden'),
  cancelled('cancelled'),
  upstream('upstream'),
  internal('internal'),
  ;

  const ErrorCode(this.wire);

  /// The exact string on the wire.
  final String wire;

  static ErrorCode fromWire(String value, [String field = 'errorCode']) =>
      tryFromWire(value) ??
      _bad(field, 'one of ${ErrorCode.values.map((e) => e.wire).join(', ')}', value);

  /// Null rather than an exception for an unrecognised value.
  static ErrorCode? tryFromWire(String value) {
    for (final e in ErrorCode.values) {
      if (e.wire == value) return e;
    }
    return null;
  }
}

@immutable
class ApiError {
  const ApiError({
    required this.code,
    required this.message,
    this.detail,
  });

  factory ApiError.fromJson(Map<String, dynamic> json) => ApiError(
        code: ErrorCode.fromWire(_reqStr(json, 'code'), 'code'),
        message: _reqStr(json, 'message'),
        detail: _optMap(json, 'detail'),
      );

  /// Stable failure codes the UI may branch on.
  final ErrorCode code;
  /// Safe to display. Never contains secrets.
  final String message;
  final Map<String, dynamic>? detail;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'code': code.wire,
        'message': message,
        if (detail != null) 'detail': detail,
      };
}

@immutable
class HealthResponse {
  const HealthResponse({
    required this.ok,
    required this.version,
    required this.uptime,
    required this.protocol,
  });

  factory HealthResponse.fromJson(Map<String, dynamic> json) => HealthResponse(
        ok: _reqBool(json, 'ok'),
        version: _reqStr(json, 'version'),
        uptime: _reqNum(json, 'uptime'),
        protocol: _reqInt(json, 'protocol'),
      );

  final bool ok;
  final String version;
  final double uptime;
  final int protocol;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'ok': ok,
        'version': version,
        'uptime': uptime,
        'protocol': protocol,
      };
}

/// Lifecycle of a session. Only an active session accepts new turns.
enum SessionState {
  active('active'),
  ended('ended'),
  archived('archived'),
  ;

  const SessionState(this.wire);

  /// The exact string on the wire.
  final String wire;

  static SessionState fromWire(String value, [String field = 'sessionState']) =>
      tryFromWire(value) ??
      _bad(field, 'one of ${SessionState.values.map((e) => e.wire).join(', ')}', value);

  /// Null rather than an exception for an unrecognised value.
  static SessionState? tryFromWire(String value) {
    for (final e in SessionState.values) {
      if (e.wire == value) return e;
    }
    return null;
  }
}

@immutable
class Session {
  const Session({
    required this.id,
    this.title,
    required this.state,
    required this.createdAt,
    required this.updatedAt,
    required this.provider,
    required this.model,
    required this.messageCount,
    required this.tokensIn,
    required this.tokensOut,
  });

  factory Session.fromJson(Map<String, dynamic> json) => Session(
        id: _reqStr(json, 'id'),
        title: _optStr(json, 'title'),
        state: SessionState.fromWire(_reqStr(json, 'state'), 'state'),
        createdAt: _reqInt(json, 'createdAt'),
        updatedAt: _reqInt(json, 'updatedAt'),
        provider: _reqStr(json, 'provider'),
        model: _reqStr(json, 'model'),
        messageCount: _reqInt(json, 'messageCount'),
        tokensIn: _reqInt(json, 'tokensIn'),
        tokensOut: _reqInt(json, 'tokensOut'),
      );

  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String id;
  final String? title;
  /// Lifecycle of a session. Only an active session accepts new turns.
  final SessionState state;
  final int createdAt;
  final int updatedAt;
  final String provider;
  final String model;
  final int messageCount;
  final int tokensIn;
  final int tokensOut;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        if (title != null) 'title': title,
        'state': state.wire,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
        'provider': provider,
        'model': model,
        'messageCount': messageCount,
        'tokensIn': tokensIn,
        'tokensOut': tokensOut,
      };
}

@immutable
class SessionList {
  const SessionList({
    required this.sessions,
    this.nextCursor,
  });

  factory SessionList.fromJson(Map<String, dynamic> json) => SessionList(
        sessions: _reqObjList<Session>(json, 'sessions', Session.fromJson),
        nextCursor: _optStr(json, 'nextCursor'),
      );

  final List<Session> sessions;
  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String? nextCursor;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'sessions': sessions.map((e) => e.toJson()).toList(),
        if (nextCursor != null) 'nextCursor': nextCursor,
      };
}

@immutable
class CreateSessionRequest {
  const CreateSessionRequest({
    this.provider,
    this.model,
    this.title,
  });

  factory CreateSessionRequest.fromJson(Map<String, dynamic> json) => CreateSessionRequest(
        provider: _optStr(json, 'provider'),
        model: _optStr(json, 'model'),
        title: _optStr(json, 'title'),
      );

  final String? provider;
  final String? model;
  final String? title;

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (provider != null) 'provider': provider,
        if (model != null) 'model': model,
        if (title != null) 'title': title,
      };
}

@immutable
class RenameSessionRequest {
  const RenameSessionRequest({
    required this.title,
  });

  factory RenameSessionRequest.fromJson(Map<String, dynamic> json) => RenameSessionRequest(
        title: _reqStr(json, 'title'),
      );

  final String title;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'title': title,
      };
}

/// Who produced the message.
enum MessageRole {
  system('system'),
  user('user'),
  assistant('assistant'),
  tool('tool'),
  ;

  const MessageRole(this.wire);

  /// The exact string on the wire.
  final String wire;

  static MessageRole fromWire(String value, [String field = 'messageRole']) =>
      tryFromWire(value) ??
      _bad(field, 'one of ${MessageRole.values.map((e) => e.wire).join(', ')}', value);

  /// Null rather than an exception for an unrecognised value.
  static MessageRole? tryFromWire(String value) {
    for (final e in MessageRole.values) {
      if (e.wire == value) return e;
    }
    return null;
  }
}

/// Why generation stopped.
enum FinishReason {
  complete('complete'),
  interrupted('interrupted'),
  length('length'),
  error('error'),
  toolCalls('tool_calls'),
  ;

  const FinishReason(this.wire);

  /// The exact string on the wire.
  final String wire;

  static FinishReason fromWire(String value, [String field = 'finishReason']) =>
      tryFromWire(value) ??
      _bad(field, 'one of ${FinishReason.values.map((e) => e.wire).join(', ')}', value);

  /// Null rather than an exception for an unrecognised value.
  static FinishReason? tryFromWire(String value) {
    for (final e in FinishReason.values) {
      if (e.wire == value) return e;
    }
    return null;
  }
}

@immutable
class Message {
  const Message({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.content,
    required this.createdAt,
    required this.seq,
    this.finishReason,
    this.tokensIn,
    this.tokensOut,
  });

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: _reqStr(json, 'id'),
        sessionId: _reqStr(json, 'sessionId'),
        role: MessageRole.fromWire(_reqStr(json, 'role'), 'role'),
        content: _reqStr(json, 'content'),
        createdAt: _reqInt(json, 'createdAt'),
        seq: _reqInt(json, 'seq'),
        finishReason: json['finishReason'] == null ? null : FinishReason.fromWire(_reqStr(json, 'finishReason'), 'finishReason'),
        tokensIn: _optInt(json, 'tokensIn'),
        tokensOut: _optInt(json, 'tokensOut'),
      );

  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String id;
  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String sessionId;
  /// Who produced the message.
  final MessageRole role;
  final String content;
  final int createdAt;
  final int seq;
  /// Why generation stopped.
  final FinishReason? finishReason;
  final int? tokensIn;
  final int? tokensOut;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'sessionId': sessionId,
        'role': role.wire,
        'content': content,
        'createdAt': createdAt,
        'seq': seq,
        if (finishReason != null) 'finishReason': finishReason!.wire,
        if (tokensIn != null) 'tokensIn': tokensIn,
        if (tokensOut != null) 'tokensOut': tokensOut,
      };
}

@immutable
class MessagePage {
  const MessagePage({
    required this.messages,
    this.nextCursor,
  });

  factory MessagePage.fromJson(Map<String, dynamic> json) => MessagePage(
        messages: _reqObjList<Message>(json, 'messages', Message.fromJson),
        nextCursor: _optInt(json, 'nextCursor'),
      );

  final List<Message> messages;
  final int? nextCursor;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'messages': messages.map((e) => e.toJson()).toList(),
        if (nextCursor != null) 'nextCursor': nextCursor,
      };
}

/// Which adapter drives this provider.
enum ProviderKind {
  openaiCompatible('openai_compatible'),
  anthropic('anthropic'),
  gemini('gemini'),
  ;

  const ProviderKind(this.wire);

  /// The exact string on the wire.
  final String wire;

  static ProviderKind fromWire(String value, [String field = 'providerKind']) =>
      tryFromWire(value) ??
      _bad(field, 'one of ${ProviderKind.values.map((e) => e.wire).join(', ')}', value);

  /// Null rather than an exception for an unrecognised value.
  static ProviderKind? tryFromWire(String value) {
    for (final e in ProviderKind.values) {
      if (e.wire == value) return e;
    }
    return null;
  }
}

@immutable
class Provider {
  const Provider({
    required this.id,
    required this.kind,
    required this.label,
    required this.baseUrl,
    required this.defaultModel,
    required this.contextWindow,
    required this.maxTokens,
    required this.temperature,
    required this.supportsTools,
    required this.hasKey,
  });

  factory Provider.fromJson(Map<String, dynamic> json) => Provider(
        id: _reqStr(json, 'id'),
        kind: ProviderKind.fromWire(_reqStr(json, 'kind'), 'kind'),
        label: _reqStr(json, 'label'),
        baseUrl: _reqStr(json, 'baseUrl'),
        defaultModel: _reqStr(json, 'defaultModel'),
        contextWindow: _reqInt(json, 'contextWindow'),
        maxTokens: _reqInt(json, 'maxTokens'),
        temperature: _reqNum(json, 'temperature'),
        supportsTools: _reqBool(json, 'supportsTools'),
        hasKey: _reqBool(json, 'hasKey'),
      );

  final String id;
  /// Which adapter drives this provider.
  final ProviderKind kind;
  final String label;
  final String baseUrl;
  final String defaultModel;
  final int contextWindow;
  final int maxTokens;
  final double temperature;
  final bool supportsTools;
  final bool hasKey;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'kind': kind.wire,
        'label': label,
        'baseUrl': baseUrl,
        'defaultModel': defaultModel,
        'contextWindow': contextWindow,
        'maxTokens': maxTokens,
        'temperature': temperature,
        'supportsTools': supportsTools,
        'hasKey': hasKey,
      };
}

@immutable
class ProviderList {
  const ProviderList({
    required this.providers,
    required this.defaultProvider,
  });

  factory ProviderList.fromJson(Map<String, dynamic> json) => ProviderList(
        providers: _reqObjList<Provider>(json, 'providers', Provider.fromJson),
        defaultProvider: _reqStr(json, 'defaultProvider'),
      );

  final List<Provider> providers;
  final String defaultProvider;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'providers': providers.map((e) => e.toJson()).toList(),
        'defaultProvider': defaultProvider,
      };
}

@immutable
class ModelInfo {
  const ModelInfo({
    required this.id,
    this.label,
  });

  factory ModelInfo.fromJson(Map<String, dynamic> json) => ModelInfo(
        id: _reqStr(json, 'id'),
        label: _optStr(json, 'label'),
      );

  final String id;
  final String? label;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        if (label != null) 'label': label,
      };
}

@immutable
class ModelList {
  const ModelList({
    required this.models,
    required this.discovered,
  });

  factory ModelList.fromJson(Map<String, dynamic> json) => ModelList(
        models: _reqObjList<ModelInfo>(json, 'models', ModelInfo.fromJson),
        discovered: _reqBool(json, 'discovered'),
      );

  final List<ModelInfo> models;
  final bool discovered;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'models': models.map((e) => e.toJson()).toList(),
        'discovered': discovered,
      };
}

@immutable
class ProviderCheck {
  const ProviderCheck({
    required this.ok,
    this.error,
    this.latencyMs,
  });

  factory ProviderCheck.fromJson(Map<String, dynamic> json) => ProviderCheck(
        ok: _reqBool(json, 'ok'),
        error: json['error'] == null ? null : ApiError.fromJson(_reqMap(json, 'error')),
        latencyMs: _optInt(json, 'latencyMs'),
      );

  final bool ok;
  final ApiError? error;
  final int? latencyMs;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'ok': ok,
        if (error != null) 'error': error!.toJson(),
        if (latencyMs != null) 'latencyMs': latencyMs,
      };
}

@immutable
class SetCredentialRequest {
  const SetCredentialRequest({
    required this.providerId,
    required this.apiKey,
  });

  factory SetCredentialRequest.fromJson(Map<String, dynamic> json) => SetCredentialRequest(
        providerId: _reqStr(json, 'providerId'),
        apiKey: _reqStr(json, 'apiKey'),
      );

  final String providerId;
  final String apiKey;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'providerId': providerId,
        'apiKey': apiKey,
      };
}

@immutable
class ChatRequest {
  const ChatRequest({
    required this.sessionId,
    required this.message,
  });

  factory ChatRequest.fromJson(Map<String, dynamic> json) => ChatRequest(
        sessionId: _reqStr(json, 'sessionId'),
        message: _reqStr(json, 'message'),
      );

  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String sessionId;
  final String message;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'sessionId': sessionId,
        'message': message,
      };
}

@immutable
class EchoRequest {
  const EchoRequest({
    required this.message,
    this.delayMs,
    this.failAfter,
  });

  factory EchoRequest.fromJson(Map<String, dynamic> json) => EchoRequest(
        message: _reqStr(json, 'message'),
        delayMs: _optInt(json, 'delayMs'),
        failAfter: _optInt(json, 'failAfter'),
      );

  final String message;
  final int? delayMs;
  final int? failAfter;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'message': message,
        if (delayMs != null) 'delayMs': delayMs,
        if (failAfter != null) 'failAfter': failAfter,
      };
}

@immutable
class StreamStart extends StreamEvent {
  const StreamStart({
    required this.type,
    required this.messageId,
    this.sessionId,
    this.seq,
  });

  factory StreamStart.fromJson(Map<String, dynamic> json) => StreamStart(
        type: _reqStr(json, 'type'),
        messageId: _reqStr(json, 'messageId'),
        sessionId: _optStr(json, 'sessionId'),
        seq: _optInt(json, 'seq'),
      );

  final String type;
  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String messageId;
  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String? sessionId;
  final int? seq;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'messageId': messageId,
        if (sessionId != null) 'sessionId': sessionId,
        if (seq != null) 'seq': seq,
      };
}

@immutable
class StreamDelta extends StreamEvent {
  const StreamDelta({
    required this.type,
    required this.text,
  });

  factory StreamDelta.fromJson(Map<String, dynamic> json) => StreamDelta(
        type: _reqStr(json, 'type'),
        text: _reqStr(json, 'text'),
      );

  final String type;
  final String text;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'text': text,
      };
}

@immutable
class StreamDone extends StreamEvent {
  const StreamDone({
    required this.type,
    required this.reason,
    required this.chars,
    this.tokensIn,
    this.tokensOut,
  });

  factory StreamDone.fromJson(Map<String, dynamic> json) => StreamDone(
        type: _reqStr(json, 'type'),
        reason: _reqOneOf(json, 'reason', const <String>['complete', 'interrupted', 'length']),
        chars: _reqInt(json, 'chars'),
        tokensIn: _optInt(json, 'tokensIn'),
        tokensOut: _optInt(json, 'tokensOut'),
      );

  final String type;
  final String reason;
  final int chars;
  final int? tokensIn;
  final int? tokensOut;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'reason': reason,
        'chars': chars,
        if (tokensIn != null) 'tokensIn': tokensIn,
        if (tokensOut != null) 'tokensOut': tokensOut,
      };
}

@immutable
class StreamError extends StreamEvent {
  const StreamError({
    required this.type,
    required this.error,
  });

  factory StreamError.fromJson(Map<String, dynamic> json) => StreamError(
        type: _reqStr(json, 'type'),
        error: ApiError.fromJson(_reqMap(json, 'error')),
      );

  final String type;
  final ApiError error;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'error': error.toJson(),
      };
}

/// Discriminated on `type`. Exactly one terminal event per stream.
@immutable
sealed class StreamEvent {
  const StreamEvent();

  factory StreamEvent.fromJson(Map<String, dynamic> json) {
    final type = _reqStr(json, 'type');
    switch (type) {
      case 'start':
        return StreamStart.fromJson(json);
      case 'delta':
        return StreamDelta.fromJson(json);
      case 'done':
        return StreamDone.fromJson(json);
      case 'error':
        return StreamError.fromJson(json);
      default:
        return _bad('type', 'a known StreamEvent variant', type);
    }
  }

  Map<String, dynamic> toJson();
}

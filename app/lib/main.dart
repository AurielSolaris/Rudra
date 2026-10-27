import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rudra/ui/common/theme.dart';
import 'package:rudra/ui/shell/app_shell.dart';

void main() {
  runApp(const ProviderScope(child: RudraApp()));
}

class RudraApp extends StatelessWidget {
  const RudraApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      // §9/§10: the window title names the current context. One session for
      // now, so it is just the app.
      title: 'Rudra',
      debugShowCheckedModeBanner: false,
      // §13: follow the platform theme by default, with an explicit override
      // in settings later.
      themeMode: ThemeMode.system,
      theme: buildRudraTheme(Brightness.light),
      darkTheme: buildRudraTheme(Brightness.dark),
      home: const BootGate(),
    );
  }
}

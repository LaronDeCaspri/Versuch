import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'lane_guidance_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Navi läuft im Hochformat.
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  runApp(const MasarApp());
}

class MasarApp extends StatelessWidget {
  const MasarApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Masar',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        fontFamily: 'Roboto',
      ),
      home: const LaneGuidanceScreen(),
    );
  }
}

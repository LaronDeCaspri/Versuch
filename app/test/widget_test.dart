import 'package:flutter_test/flutter_test.dart';

import 'package:masar/main.dart';

void main() {
  testWidgets('Masar startet und zeigt den Fahrspur-Bildschirm', (tester) async {
    await tester.pumpWidget(const MasarApp());
    // Steuerknopf zum Simulieren ist sichtbar.
    expect(find.text('Fahrt simulieren'), findsOneWidget);
    // Sprach-Umschalter vorhanden.
    expect(find.text('AR'), findsOneWidget);
  });
}

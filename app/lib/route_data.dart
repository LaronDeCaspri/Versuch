/// Demo-Streckendaten für den Fahrspur-Assistenten.
///
/// Später ersetzt das HERE-Routing diese Klassen: `Maneuver` wird aus den
/// HERE-Navigations-Events (Spur-Infos, Junction Views, Entfernungen) gefüllt.
library;

enum ManeuverType { through, right, slightRight, left }

enum LaneArrow { through, right, slightRight, left }

class Maneuver {
  /// Entfernung in Metern, ab der dieses Manöver angekündigt wird.
  final double startDistance;
  final ManeuverType type;

  /// Ausfahrtnummer, z. B. "12" – oder null, wenn keine Ausfahrt.
  final String? exit;

  /// Reihenfolge der Spuren von links nach rechts.
  final List<LaneArrow> lanes;

  /// Indizes der Spuren, die man nehmen muss (0 = ganz links).
  final List<int> highlight;

  /// Entfernung eines Saher-Blitzers vor dem Manöver, in Metern.
  /// 0 = Blitzer sitzt genau am Manöverpunkt. null = kein Blitzer.
  final double? cameraAt;

  /// Tempolimit in km/h.
  final int limit;

  /// Straßenname je Sprache (Schlüssel: 'de' | 'en' | 'ar').
  final Map<String, String> road;

  /// Hinweistext je Sprache.
  final Map<String, String> sub;

  const Maneuver({
    required this.startDistance,
    required this.type,
    required this.lanes,
    required this.highlight,
    required this.limit,
    required this.road,
    required this.sub,
    this.exit,
    this.cameraAt,
  });

  /// Mittelpunkt der markierten Spuren (für die Führungslinie auf der Straße).
  double get highlightCenter =>
      highlight.reduce((a, b) => a + b) / highlight.length;
}

/// Beispielroute durch Riad – wird in Schleife abgespielt.
const List<Maneuver> demoRoute = [
  Maneuver(
    startDistance: 1200,
    type: ManeuverType.right,
    exit: '12',
    lanes: [
      LaneArrow.through,
      LaneArrow.through,
      LaneArrow.right,
      LaneArrow.right,
    ],
    highlight: [2, 3],
    cameraAt: 500,
    limit: 120,
    road: {
      'de': 'Ausfahrt 12 · King Fahd Rd',
      'en': 'Exit 12 · King Fahd Rd',
      'ar': 'المخرج 12 · طريق الملك فهد',
    },
    sub: {
      'de': 'dann rechts halten',
      'en': 'then keep right',
      'ar': 'ثم ابقَ يمينًا',
    },
  ),
  Maneuver(
    startDistance: 900,
    type: ManeuverType.slightRight,
    exit: '8A',
    lanes: [
      LaneArrow.through,
      LaneArrow.through,
      LaneArrow.slightRight,
    ],
    highlight: [2],
    cameraAt: 0,
    limit: 100,
    road: {
      'de': 'Ausfahrt 8A · Al Olaya',
      'en': 'Exit 8A · Al Olaya',
      'ar': 'المخرج 8أ · العليا',
    },
    sub: {
      'de': 'leicht rechts einordnen',
      'en': 'take slight right',
      'ar': 'انعطف يمينًا قليلًا',
    },
  ),
  Maneuver(
    startDistance: 700,
    type: ManeuverType.left,
    lanes: [
      LaneArrow.left,
      LaneArrow.left,
      LaneArrow.through,
      LaneArrow.through,
    ],
    highlight: [0, 1],
    cameraAt: 400,
    limit: 80,
    road: {
      'de': 'King Abdullah Rd',
      'en': 'King Abdullah Rd',
      'ar': 'طريق الملك عبدالله',
    },
    sub: {
      'de': 'links halten',
      'en': 'keep left',
      'ar': 'ابقَ يسارًا',
    },
  ),
];

/// Kurze Übersetzungstabelle für die Oberfläche.
class Strings {
  static const Map<String, Map<String, String>> _t = {
    'lanes': {'de': 'Fahrspuren', 'en': 'Lanes', 'ar': 'المسارات'},
    'camera': {'de': 'Saher-Blitzer', 'en': 'Saher speed camera', 'ar': 'كاميرا ساهر'},
    'kmh': {'de': 'km/h', 'en': 'km/h', 'ar': 'كم/س'},
    'unit_m': {'de': 'm', 'en': 'm', 'ar': 'م'},
    'play': {'de': 'Fahrt simulieren', 'en': 'Simulate drive', 'ar': 'محاكاة القيادة'},
    'pause': {'de': 'Pause', 'en': 'Pause', 'ar': 'إيقاف'},
  };

  static String of(String key, String lang) =>
      _t[key]?[lang] ?? _t[key]?['en'] ?? key;

  static String limitText(int limit, String lang) {
    switch (lang) {
      case 'ar':
        return 'حد السرعة $limit كم/س';
      case 'de':
        return 'Tempolimit $limit km/h';
      default:
        return 'Speed limit $limit km/h';
    }
  }
}

// Polish strings for the app area; see ./index.ts.
const pl: Record<string, string> = {
  // Times and network status
  now: 'teraz',
  '{n}m': '{n} min',
  '{n}h': '{n} godz.',
  '{n}d': '{n} d',
  'Searching for peers': 'Szukam innych urządzeń',
  'Announced on the network': 'Widoczne w sieci',
  'Peer connecting': 'Urządzenie się łączy',
  'Peer verified': 'Urządzenie zweryfikowane',
  'Network problem, retrying': 'Problem z siecią, ponawiam',
  'Not connected': 'Brak połączenia',
  'Syncing board': 'Synchronizuję tablicę',
  'Update installed. Close and reopen OpenCollab to use it.':
    'Aktualizacja zainstalowana. Zamknij i otwórz OpenCollab ponownie, żeby z niej korzystać.',
  'Downloading an update…': 'Pobieram aktualizację…',

  // Alerts from the worker
  'Identity error': 'Błąd konta',
  'Unnamed board': 'Tablica bez nazwy',
  'Not done': 'Nie udało się',
  Export: 'Eksport',
  'Could not share the file.': 'Nie udało się udostępnić pliku.',
  'Something went wrong': 'Coś poszło nie tak',

  // Log in and recovery words
  "Your private boards and feeds. No servers: everything lives on your and your friends' devices.":
    'Twoje prywatne tablice i aktualności. Bez serwerów: wszystko jest tylko na urządzeniach twoich i twoich znajomych.',
  'Log in': 'Zaloguj się',
  'Create new account': 'Utwórz nowe konto',
  'Log in with recovery words': 'Zaloguj się słowami odzyskiwania',
  'Enter the 24 recovery words you wrote down when you created your account.':
    'Wpisz 24 słowa odzyskiwania zapisane podczas tworzenia konta.',
  'Recovery words': 'Słowa odzyskiwania',
  Back: 'Wstecz',
  'Save your recovery words': 'Zapisz słowa odzyskiwania',
  'These 24 words are the only way to log in to your account on another device or after reinstalling. Write them down and keep them somewhere safe, offline.':
    'Te 24 słowa to jedyny sposób, żeby zalogować się na swoje konto na innym urządzeniu albo po ponownej instalacji. Zapisz je i schowaj w bezpiecznym miejscu, poza internetem.',
  "I've written it down": 'Mam je zapisane',
  'Identity required': 'Potrzebne konto',
  'Enter a recovery phrase with at least 12 words.':
    'Wpisz słowa odzyskiwania: co najmniej 12 słów.',
  'Unlock OpenCollab': 'Odblokuj OpenCollab',
  'Not unlocked': 'Nie odblokowano',
  'Tap Log in to try again, or log in with your recovery words.':
    'Stuknij Zaloguj się, żeby spróbować ponownie, albo zaloguj się słowami odzyskiwania.',
  'Nothing saved': 'Nic nie zapisano',
  'Enter your recovery words to continue.': 'Wpisz słowa odzyskiwania, żeby kontynuować.',
  'Save your OpenCollab recovery words': 'Zapisz słowa odzyskiwania OpenCollab',
  'Not saved': 'Nie zapisano',
  'OpenCollab then opens without asking for them. If you don’t save them, they stay in memory only and you enter them each time you open the app. You can change this later in Settings.':
    'Wtedy OpenCollab otworzy się bez pytania o nie. Jeśli ich nie zapiszesz, zostaną tylko w pamięci i wpiszesz je przy każdym otwarciu aplikacji. Możesz to później zmienić w Ustawieniach.',
  'Don’t save': 'Nie zapisuj',

  // Boards list, new board, join
  Boards: 'Tablice',
  'New board': 'Nowa tablica',
  Join: 'Dołącz',
  'Try a sample board': 'Wypróbuj przykładową tablicę',
  'Recently joined': 'Ostatnio dołączone',
  'Open {board}': 'Otwórz {board}',
  'Swipe left on a board to remove it.': 'Przesuń tablicę w lewo, żeby ją usunąć.',
  'No boards yet. Create one or join with an invitation.':
    'Nie masz jeszcze tablic. Utwórz nową albo dołącz z zaproszenia.',
  'Shared items ({count})': 'Udostępnione ({count})',
  'Log out': 'Wyloguj się',
  'Remove {name}': 'Usuń {name}',
  'Give your board a name.': 'Nadaj tablicy nazwę.',
  'You will get an invitation link to share once the board is ready.':
    'Gdy tablica będzie gotowa, dostaniesz link z zaproszeniem do udostępnienia.',
  'Board name': 'Nazwa tablicy',
  Next: 'Dalej',
  'What is “{board}” for? You can change it later in Board settings.':
    'Do czego służy „{board}”? Możesz to później zmienić w Ustawieniach tablicy.',
  'Create board': 'Utwórz tablicę',
  'Join board': 'Dołącz do tablicy',
  "Scan a board member's invitation QR code, or paste the link they sent you.":
    'Zeskanuj kod QR z zaproszeniem od członka tablicy albo wklej otrzymany od niego link.',
  'Scan QR code': 'Zeskanuj kod QR',
  'Paste invitation': 'Wklej zaproszenie',
  'Paste an invitation link first.': 'Najpierw wklej link z zaproszeniem.',
  'Clipboard is empty. Copy an invitation link first.':
    'Schowek jest pusty. Najpierw skopiuj link z zaproszeniem.',

  // Display name and profile
  'Choose your display name': 'Wybierz swoją nazwę',
  'Other participants will see this beside your objects and comments.':
    'Inni uczestnicy zobaczą ją przy twoich kartach i komentarzach.',
  'Name or nickname': 'Imię lub pseudonim',
  Continue: 'Dalej',
  'Edit name & avatar': 'Zmień nazwę i awatar',
  'Change avatar': 'Zmień awatar',
  'Remove avatar': 'Usuń awatar',
  'Display name': 'Wyświetlana nazwa',
  'Everyone on this board sees your name and avatar.':
    'Wszyscy na tej tablicy widzą twoją nazwę i awatar.',
  'Share invitation': 'Udostępnij zaproszenie',
  'Show QR code': 'Pokaż kod QR',
  'Exporting…': 'Eksportuję…',
  'Export board': 'Eksportuj tablicę',
  'Switch board': 'Zmień tablicę',
  'Scan to join {board}': 'Zeskanuj, żeby dołączyć do „{board}”',
  'Scan to join this board': 'Zeskanuj, żeby dołączyć do tej tablicy',
  'On the other phone, open OpenCollab, tap Join, then Scan QR code.':
    'Na drugim telefonie otwórz OpenCollab, stuknij Dołącz, a potem Zeskanuj kod QR.',
  'Share link': 'Udostępnij link',

  // Waiting for a board, new card composer
  'Waiting for a board member…': 'Czekam na członka tablicy…',
  "Boards live only on members' devices. This one fills in automatically as soon as another member opens it — keep OpenCollab open until then.":
    'Tablice są tylko na urządzeniach członków. Ta wypełni się sama, gdy tylko inny członek ją otworzy — do tego czasu nie zamykaj OpenCollab.',
  'New card in {column}': 'Nowa karta · {column}',
  'Add card': 'Dodaj kartę',
  Title: 'Tytuł',
  'Description or proposal': 'Opis lub propozycja',
  'Original: {source}': 'Oryginał: {source}',
  'Remove the link to the original': 'Usuń link do oryginału',
  'Remove image': 'Usuń zdjęcie',
  'Images {count}/{max}': 'Zdjęcia {count}/{max}',
  'Attach images': 'Dołącz zdjęcia',
  'Image limit': 'Limit zdjęć',
  'Up to {max} images per post.': 'Najwyżej {max} zdjęcia na wpis.',
  'Close image': 'Zamknij zdjęcie',

  // QR invitations
  'Invitation QR code': 'Kod QR z zaproszeniem',
  'Allow the camera to scan an invitation QR code.':
    'Zezwól na dostęp do aparatu, żeby zeskanować kod QR z zaproszeniem.',
  'Allow camera': 'Zezwól na aparat',
  'Point at an invitation QR code': 'Skieruj aparat na kod QR z zaproszeniem',
  'Close scanner': 'Zamknij skaner',

  // Settings
  Settings: 'Ustawienia',
  'Not saved on this device. You enter them each time you open OpenCollab.':
    'Nie są zapisane na tym urządzeniu. Wpisujesz je przy każdym otwarciu OpenCollab.',
  'Forget recovery words?': 'Zapomnieć słowa odzyskiwania?',
  'They are removed from this device. Make sure you have them written down: you will need them to open OpenCollab again.':
    'Zostaną usunięte z tego urządzenia. Upewnij się, że masz je zapisane: będą ci potrzebne, żeby znów otworzyć OpenCollab.',
  Forget: 'Zapomnij',
  'Save recovery words in the iOS Keychain?': 'Zapisać słowa odzyskiwania w pęku kluczy iOS?',
  'Saved in the iOS Keychain on this device.': 'Zapisane w pęku kluczy iOS na tym urządzeniu.',
  'Saved in the iOS Keychain on this device, unlocked with Face ID or Touch ID. If the enrolled faces or fingerprints change, you enter the words once more.':
    'Zapisane w pęku kluczy iOS na tym urządzeniu, odblokowywane przez Face ID lub Touch ID. Jeśli zmienią się zapisane twarze lub odciski palców, wpiszesz słowa jeszcze raz.',
  'Save in Keychain': 'Zapisz w pęku kluczy',
  'Forget from Keychain': 'Usuń z pęku kluczy',
  'The Keychain refused the phrase.': 'Pęk kluczy nie przyjął słów.',
  'Save recovery words on this device?': 'Zapisać słowa odzyskiwania na tym urządzeniu?',
  'Saved in encrypted storage on this device.':
    'Zapisane w zaszyfrowanej pamięci na tym urządzeniu.',
  'Saved in encrypted storage on this device, unlocked with your fingerprint or face. If the enrolled fingerprints or faces change, you enter the words once more.':
    'Zapisane w zaszyfrowanej pamięci na tym urządzeniu, odblokowywane odciskiem palca lub twarzą. Jeśli zmienią się zapisane odciski palców lub twarze, wpiszesz słowa jeszcze raz.',
  'Save on this device': 'Zapisz na tym urządzeniu',
  'Forget from this device': 'Usuń z tego urządzenia',
  'Secure storage refused the phrase.': 'Bezpieczna pamięć nie przyjęła słów.',
  Appearance: 'Wygląd',
  System: 'Systemowy',
  Light: 'Jasny',
  Dark: 'Ciemny',
  Language: 'Język',
  'Your theme': 'Twój motyw',
  'Changes how boards look on this device only. Others keep the board’s theme.':
    'Zmienia wygląd tablic tylko na tym urządzeniu. Inni widzą motyw tablicy.',
  'Board default': 'Domyślny tablicy',
  'Notification sound': 'Dźwięk powiadomień',
  'Plays when new notifications arrive while the app is open.':
    'Gra, gdy przychodzą nowe powiadomienia, a aplikacja jest otwarta.',
  Off: 'Wyłączony',
  Chime: 'Dzwonek',
  Pop: 'Pyk',
  Ding: 'Ding',

  // Shared from other apps
  'Shared link': 'Udostępniony link',
  'Add to board': 'Dodaj do tablicy',
  'Add to {board}': 'Dodaj do {board}',
  OPEN: 'OTWARTA',
  'All your boards are hidden from sharing. Turn one back on in Board settings → Share menu.':
    'Wszystkie twoje tablice są ukryte przy udostępnianiu. Włącz którąś z powrotem w Ustawieniach tablicy → Menu udostępniania.',
  'No boards yet. Create or join a board, then share again.':
    'Nie masz jeszcze tablic. Utwórz tablicę albo do niej dołącz i udostępnij jeszcze raz.',
  'Loading the link preview…': 'Wczytuję podgląd linku…',
  'Shared item': 'Udostępniony element',
  'ADD TO BOARD': 'DODAJ DO TABLICY',
  'Open link': 'Otwórz link',
  'Remove from this list': 'Usuń z tej listy',
  'Remove this shared item?': 'Usunąć ten udostępniony element?',
  'Cards already made from it stay.': 'Utworzone z niego karty zostaną.',
  'Shared items': 'Udostępnione',
  'Links and posts you shared to OpenCollab from other apps. Kept on this device only.':
    'Linki i posty udostępnione do OpenCollab z innych aplikacji. Przechowywane tylko na tym urządzeniu.',
  'Nothing shared yet. In any app, tap Share and choose OpenCollab.':
    'Nic jeszcze nie udostępniono. W dowolnej aplikacji stuknij Udostępnij i wybierz OpenCollab.',
  'Added to {board} just now': 'Dodano do „{board}” przed chwilą',
  'Added to {board} {time} ago': 'Dodano do „{board}” {time} temu',
  'Shared just now · not on a board': 'Udostępniono przed chwilą · nie na tablicy',
  'Shared {time} ago · not on a board': 'Udostępniono {time} temu · nie na tablicy',
  'Show description': 'Pokaż opis',
  'Hide description': 'Ukryj opis'
}

export default pl

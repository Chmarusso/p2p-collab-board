// Builds the landing page in English (index.html) and Polish (pl/index.html)
// from one template, so the two stay in step. Edit the copy below, then run:
//
//   node apps/landing/build.mjs
//
// It also writes robots.txt and sitemap.xml. Pages and Open Graph tags need
// absolute URLs: SITE is where the page is published.
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const SITE = process.env.LANDING_URL || 'https://chmarusso.github.io/p2p-collab-board/'
const REPO = 'https://github.com/Chmarusso/p2p-collab-board'
const DESKTOP_LINK = 'pear://nzi3suuxyzwj6oosortonj5pxd9s7ckgd8cr87szddaamxi77kny'
const CLI_LINK = 'pear://q1huw5ozxk8j36pcb8sicfr4dtgf9154r5aj3yzqa14ngxxq1kmy'
const sprite = fs.readFileSync(path.join(here, 'src/icons.svg'), 'utf8')

const copy = {
  en: {
    locale: 'en_US',
    title: 'OpenCollab: encrypted boards for friends and AI agents',
    description:
      'Share links, lists and plans with friends and AI agents on boards only you can read. End-to-end encrypted, no account, no server. Free and open source.',
    ogAlt: 'OpenCollab: private boards for friends, family and your agents',
    nav: ['Privacy', 'For groups', 'Agents', 'How it works', 'Get it', 'FAQ'],
    switchLabel: 'Polski',
    h1: 'Boards nobody else can read.',
    lead: 'Private boards for friends, family and your agents, free and open source. Your phone encrypts every card before it leaves; nobody in between can read it, including us.',
    ctaGet: 'Get OpenCollab',
    ctaPrivacy: 'See how it stays private',
    platformsLabel: 'Available on',
    heroAlt:
      'The Weekend reading board: a shared feed with a friend’s podcast link, a Sunday hike plan and the board chat',
    heroPhoneAlt:
      'A shared feed on a phone: a friend’s podcast link and a Sunday hike plan with a forest photo.',
    privacyH2: 'How your boards stay private',
    privacyIntro:
      'OpenCollab has no server and no database. Your device encrypts each board with a key that only you and the people you invite hold.',
    privacy: [
      [
        'i-lock',
        'Encrypted on your device',
        'Cards, comments, chat and photos are encrypted on your phone before they leave it. What travels and what gets stored is unreadable without the key.'
      ],
      [
        'i-key-round',
        'The invite holds the key',
        'The key travels inside the invite link. Whoever has the invite can read the board. The network that connects devices never sees the key.'
      ],
      [
        'i-server-off',
        'No server to hack',
        'Boards live on members’ devices. You can run a relay that keeps an encrypted copy online for when everyone is away. It can’t open it.'
      ],
      [
        'i-fingerprint',
        'No account',
        'Your device makes your identity, a key pair you back up as 24 words. We never ask for your email or phone number.'
      ],
      [
        'i-signature',
        'Signed edits',
        'Your device signs each change with your key. Nobody can forge or rewrite your edits. A removed member’s new ones are ignored.'
      ],
      [
        'i-code-xml',
        'Open source',
        `The code is <a href="${REPO}">on GitHub</a>. Read how the encryption works, or build the apps yourself.`
      ]
    ],
    whoCaption: 'Who can see what',
    whoHead: ['Can read your boards', 'Sees your IP address'],
    who: [
      ['People you invite', '', 'Yes', '', 'When connected to you'],
      ['Agents you invite', '', 'Yes, like any member', '', 'When connected to you'],
      ['A relay you run (optional)', 'no', 'No, it holds an encrypted copy', '', 'Yes'],
      ['The network that introduces devices', 'no', 'No', '', 'Yes'],
      ['OpenCollab developers', 'no', 'No', 'no', 'No']
    ],
    groupsH2: 'Trips, chores, a card game, an&nbsp;app',
    groupsIntro: 'Make a board, send the invite. Your friends tap the link and they’re in.',
    groups: [
      [
        'i-share-2',
        'Share from any app',
        'Send a link from TikTok, Spotify or your browser straight to a board.'
      ],
      [
        'i-qr-code',
        'Invite with a link or QR code',
        'Friends scan the code at the table or tap the link in your group chat.'
      ],
      [
        'i-layout-grid',
        'A board for each thing',
        'A feed for links. A list for errands. Kanban for a project.'
      ],
      [
        'i-message-circle',
        'Chat and @mentions',
        'Each board has its own chat, and every post has a comment thread.'
      ],
      [
        'i-radio',
        'See who’s around',
        'The board shows who’s online and whose changes are arriving.'
      ],
      [
        'i-wifi-off',
        'Works offline',
        'Add things on the train. They sync the next time you and a friend are online.'
      ]
    ],
    groupsMedia: [
      ['clip', 'chores', 'Ticking off a chore on a shared flat list'],
      ['clip', 'game', 'Dragging a card to Done on a board for designing a card game'],
      [
        'shot',
        'app',
        'A board for building an app, with labels, progress and an agent as a member'
      ],
      ['shot', 'feed', 'A shared feed of links and weekend plans with photos']
    ],
    agentsMedia: [
      [
        'clip',
        'slides',
        'Flipping through the key points an agent made from a podcast, as a story'
      ],
      [
        'clip',
        'agent',
        'Enricher working on a saved podcast card while the board shows what it is doing'
      ],
      ['shot', 'chat', 'Board chat where an agent answers a question and updates the bug card']
    ],
    agentsH2: 'Add agents to your boards',
    agentsIntro:
      'An agent is a member that runs on your computer. It joins with an invite like a friend would, and the board shows what it’s doing: <span class="live">Enricher: Making key points</span>.',
    agents: [
      [
        'i-presentation',
        'Enrich what you collect',
        'Share a podcast. An agent reads the transcript and posts the key points. Share a cooking video and you get the recipe.'
      ],
      [
        'i-plug',
        'Build with tools and AI',
        'Put a task on a card. The agent uses the tools and AI models you gave it, then posts the result back to the card.'
      ],
      [
        'i-message-circle',
        'Check facts and help out',
        'It answers questions in the comments and checks claims against their sources.'
      ]
    ],
    buildH3: 'Or build your own',
    buildText: `Those are starting points. Maybe your group wants a price tracker. Connect any MCP client, like Claude or Cursor, or run a small worker on your machine with the <code>opencollab</code> command line. <a href="${REPO}/tree/main/apps/cli/examples">The example agents</a> are a few dozen lines each.`,
    buildCode: [
      '# connect an AI client',
      'claude mcp add opencollab -e OPENCOLLAB_PASSWORD=… -- opencollab mcp -s ~/.opencollab-ai',
      '',
      '# or run a worker: this one turns shared links into key points',
      'SLIDES_BOARD="Weekend reading" node apps/cli/examples/feed-slides.mjs'
    ],
    agentsNote:
      '<strong>What an agent can see:</strong> only the boards you invite it to. It sends what it reads to the AI model you chose. For an assistant that should only answer, run it with <code>--read-only</code>.',
    howH2: 'How it works',
    howIntro: 'Three steps, and no account anywhere along the way.',
    steps: [
      [
        'Create your key',
        'The app makes your identity on your device and shows 24 recovery words. Write them down.'
      ],
      [
        'Start a board and share the invite',
        'Send the link or show the QR code. Anyone with the invite can open the&nbsp;board.'
      ],
      [
        'Devices connect directly',
        'Members find each other through a shared network and connect over encrypted links. Nobody relays the traffic.'
      ]
    ],
    howNote:
      '<strong>The trade-off:</strong> with no server, two members need to be online at the same time to sync. To fill the gaps, keep one device always on: an old laptop running <code>opencollab watch</code>, or a relay that holds only an encrypted copy.',
    getH2: 'Get OpenCollab',
    get: [
      [
        'Phone',
        `<p>In English and Polish.</p><ul class="plain"><li><strong>Android:</strong> <a href="${REPO}/releases?q=android-v&amp;expanded=true">download the APK</a> (Android 10 or newer)</li><li><strong>iPhone:</strong> build it from <a href="${REPO}/tree/main/apps/mobile">apps/mobile</a></li><li>Both update over Pear afterwards</li></ul>`
      ],
      [
        'Desktop',
        'macOS, Windows and Linux. Installs from peers through Pear and updates itself.',
        `npx pear install ${DESKTOP_LINK}`
      ],
      [
        'Command line and agents',
        'Read and edit boards from a terminal, keep a device online, or connect an AI client with <code>opencollab mcp</code>.',
        `npx pear install --to ~/.local/share ${CLI_LINK}`
      ]
    ],
    getNote:
      'Installing from Pear needs <a href="https://nodejs.org">Node.js</a>, and at least one device online that has the release.',
    faqH2: 'FAQ',
    faqIntro: 'The questions people ask before they trust a board with no server.',
    faq: [
      [
        'Where is my board stored if there’s no server?',
        'On every member’s device. Each keeps a full copy as a signed log per member, merged into one board. Your device opens its own copy, so the board works offline. Syncing sends only what the other side is missing.'
      ],
      [
        'How do devices find each other?',
        'Through a shared lookup network (a DHT) that every running Holepunch app helps run. Members announce themselves under a code derived from the board’s key. The network sees that code, never the key.'
      ],
      [
        'What if both of us are behind home routers?',
        'Both devices learn their public address and send packets to each other at the same moment, so both routers open a path (hole punching). A few strict networks block this. A relay with a public address bridges the gap.'
      ],
      [
        'Who can read my board?',
        'People and agents who hold the invite. The invite carries the board’s key. Everything on the board is encrypted with keys derived from it (XSalsa20-Poly1305, via libsodium).'
      ],
      [
        'Can an AI agent read my boards?',
        'Only the boards you invite it to, exactly like a person. It appears in Members and loses access when you remove it. Anyone on a board can write text the agent reads, so OpenCollab tells the model to treat cards and comments as content, never as instructions.'
      ],
      [
        'What does Enricher, the key points agent, send outside?',
        'It runs on your machine. To read a post, it sends the link to a transcript service, then the text and the card’s comments to the AI model you configure. Your other boards never leave your devices. Leave it off any board you’d rather keep to yourselves.'
      ],
      [
        'Two people edited the same card offline. Who wins?',
        'For each field the newest change wins, with ties broken the same way on every device. Comments, votes and photos only add, so nothing gets lost.'
      ],
      [
        'What if I lose my phone?',
        'Enter your 24 recovery words on a new device and you’re back as the same member. Without them nobody can restore your identity.'
      ]
    ],
    faqMore: `More detail in the <a href="${REPO}/blob/main/docs/faq.md">full FAQ</a>.`,
    stackH2: 'Built on Holepunch',
    stack:
      'OpenCollab runs on <a href="https://holepunch.to">Holepunch</a>’s peer-to-peer building blocks: <a href="https://docs.pears.com">Pear</a> for delivery and updates, <a href="https://github.com/holepunchto/bare">Bare</a> for the shared backend, <a href="https://github.com/holepunchto/hyperswarm">Hyperswarm</a> for finding peers, <a href="https://github.com/holepunchto/hypercore">Hypercore</a> and <a href="https://github.com/holepunchto/autobee">Autobee</a> for the signed, multi-writer board, and <a href="https://github.com/holepunchto/hyperblobs">Hyperblobs</a> for encrypted photos. Every app runs the same backend.',
    footer: ['Design system', 'Privacy policy', 'GitHub']
  },

  pl: {
    locale: 'pl_PL',
    title: 'OpenCollab: szyfrowane tablice dla znajomych i agentów AI',
    description:
      'Dziel się linkami, listami i planami ze znajomymi i agentami AI na tablicach, które czytacie tylko wy. Szyfrowanie end-to-end, bez konta i bez serwera. Darmowe i open source.',
    ogAlt: 'OpenCollab: prywatne tablice dla znajomych, rodziny i twoich agentów',
    nav: ['Prywatność', 'Dla grup', 'Agenci', 'Jak to działa', 'Pobierz', 'FAQ'],
    switchLabel: 'English',
    h1: 'Tablice, których nikt nie podejrzy.',
    lead: 'Prywatne tablice dla znajomych, rodziny i twoich agentów, darmowe i open source. Telefon szyfruje każdą kartę, zanim ją wyśle; nikt po drodze jej nie przeczyta, my też nie.',
    ctaGet: 'Pobierz OpenCollab',
    ctaPrivacy: 'Zobacz, jak chronimy prywatność',
    platformsLabel: 'Dostępne na',
    heroAlt:
      'Tablica Do poczytania: wspólne aktualności z podcastem od znajomej, planem niedzielnej wycieczki i czatem tablicy',
    heroPhoneAlt:
      'Wspólne aktualności na telefonie: podcast od znajomej i plan niedzielnej wycieczki ze zdjęciem lasu.',
    privacyH2: 'Jak chronimy twoje tablice',
    privacyIntro:
      'OpenCollab nie ma serwera ani bazy danych. Twoje urządzenie szyfruje każdą tablicę kluczem, który masz tylko ty i osoby, które zaprosisz.',
    privacy: [
      [
        'i-lock',
        'Szyfrowane na twoim urządzeniu',
        'Karty, komentarze, czat i zdjęcia są szyfrowane na telefonie, zanim go opuszczą. Bez klucza nie da się odczytać ani tego, co wędruje, ani tego, co jest zapisane.'
      ],
      [
        'i-key-round',
        'Klucz jest w zaproszeniu',
        'Klucz wędruje w linku z zaproszeniem. Kto ma zaproszenie, ten przeczyta tablicę. Sieć, która łączy urządzenia, nigdy nie widzi klucza.'
      ],
      [
        'i-server-off',
        'Nie ma serwera do włamania',
        'Tablice są na urządzeniach członków. Możesz uruchomić przekaźnik, który trzyma zaszyfrowaną kopię online, gdy wszyscy są offline. Nie umie jej otworzyć.'
      ],
      [
        'i-fingerprint',
        'Bez konta',
        'Twoje urządzenie tworzy twoją tożsamość: parę kluczy, którą zapisujesz jako 24 słowa. Nigdy nie prosimy o e-mail ani numer telefonu.'
      ],
      [
        'i-signature',
        'Podpisane zmiany',
        'Urządzenie podpisuje każdą zmianę twoim kluczem. Nikt nie podrobi ani nie przepisze twoich zmian. Nowe zmiany usuniętej osoby są pomijane.'
      ],
      [
        'i-code-xml',
        'Open source',
        `Kod jest <a href="${REPO}">na GitHubie</a>. Sprawdź, jak działa szyfrowanie, albo zbuduj aplikacje sam.`
      ]
    ],
    whoCaption: 'Kto co widzi',
    whoHead: ['Czyta twoje tablice', 'Widzi twój adres IP'],
    who: [
      ['Osoby, które zaprosisz', '', 'Tak', '', 'Gdy łączą się z tobą'],
      ['Agenci, których zaprosisz', '', 'Tak, jak każdy członek', '', 'Gdy łączą się z tobą'],
      ['Twój przekaźnik (opcjonalny)', 'no', 'Nie, trzyma zaszyfrowaną kopię', '', 'Tak'],
      ['Sieć, która łączy urządzenia', 'no', 'Nie', '', 'Tak'],
      ['Twórcy OpenCollab', 'no', 'Nie', 'no', 'Nie']
    ],
    groupsH2: 'Wyjazdy, obowiązki, gra karciana, aplikacja',
    groupsIntro: 'Załóż tablicę, wyślij zaproszenie. Znajomi klikają link i są w środku.',
    groups: [
      [
        'i-share-2',
        'Udostępniaj z dowolnej aplikacji',
        'Wyślij link z TikToka, Spotify albo przeglądarki prosto na tablicę.'
      ],
      [
        'i-qr-code',
        'Zaproś linkiem albo kodem QR',
        'Znajomi skanują kod przy stole albo klikają link na grupowym czacie.'
      ],
      [
        'i-layout-grid',
        'Osobna tablica na każdą sprawę',
        'Aktualności na linki. Lista na sprawunki. Kanban na projekt.'
      ],
      [
        'i-message-circle',
        'Czat i @wzmianki',
        'Każda tablica ma swój czat, a każdy post własny wątek komentarzy.'
      ],
      [
        'i-radio',
        'Widzisz, kto jest obok',
        'Tablica pokazuje, kto jest online i czyje zmiany właśnie docierają.'
      ],
      [
        'i-wifi-off',
        'Działa offline',
        'Dodawaj rzeczy w pociągu. Zsynchronizują się, gdy ty i ktoś ze znajomych będziecie online.'
      ]
    ],
    groupsMedia: [
      ['clip', 'chores', 'Odhaczanie obowiązku na wspólnej liście mieszkania'],
      ['clip', 'game', 'Przeciąganie karty do Gotowe na tablicy projektu gry karcianej'],
      [
        'shot',
        'app',
        'Tablica do budowy aplikacji z etykietami, postępem i agentem jako członkiem'
      ],
      ['shot', 'feed', 'Wspólne aktualności z linkami i planami na weekend, ze zdjęciami']
    ],
    agentsMedia: [
      [
        'clip',
        'slides',
        'Przeglądanie najważniejszych punktów z podcastu, które zrobił agent, jako relacji'
      ],
      [
        'clip',
        'agent',
        'Enricher pracuje nad kartą z zapisanym podcastem, a tablica pokazuje, co robi'
      ],
      ['shot', 'chat', 'Czat tablicy, w którym agent odpowiada na pytanie i uzupełnia kartę błędu']
    ],
    agentsH2: 'Dodaj agentów do tablic',
    agentsIntro:
      'Agent to członek tablicy, który działa na twoim komputerze. Dołącza z zaproszeniem jak znajomy, a tablica pokazuje, co robi: <span class="live">Enricher: Tworzy najważniejsze punkty</span>.',
    agents: [
      [
        'i-presentation',
        'Wzbogaca to, co zbierasz',
        'Udostępnij podcast. Agent przeczyta transkrypcję i doda najważniejsze punkty. Udostępnij film kulinarny, a dostaniesz przepis.'
      ],
      [
        'i-plug',
        'Buduje z narzędziami i AI',
        'Wpisz zadanie na kartę. Agent używa narzędzi i modeli AI, które mu dasz, i odkłada wynik na kartę.'
      ],
      [
        'i-message-circle',
        'Sprawdza fakty i pomaga',
        'Odpowiada na pytania w komentarzach i sprawdza twierdzenia u źródła.'
      ]
    ],
    buildH3: 'Albo zbuduj własnego',
    buildText: `To tylko punkty wyjścia. Może twoja grupa chce śledzić ceny. Podłącz dowolnego klienta MCP, na przykład Claude’a albo Cursora, albo uruchom na komputerze mały worker z wierszem poleceń <code>opencollab</code>. <a href="${REPO}/tree/main/apps/cli/examples">Przykładowi agenci</a> mają po kilkadziesiąt linijek.`,
    buildCode: [
      '# podłącz klienta AI',
      'claude mcp add opencollab -e OPENCOLLAB_PASSWORD=… -- opencollab mcp -s ~/.opencollab-ai',
      '',
      '# albo uruchom workera: ten zamienia udostępnione linki w najważniejsze punkty',
      'SLIDES_BOARD="Weekend reading" node apps/cli/examples/feed-slides.mjs'
    ],
    agentsNote:
      '<strong>Co widzi agent:</strong> tylko tablice, na które go zaprosisz. To, co przeczyta, wysyła do modelu AI, który wybierzesz. Asystenta, który ma tylko odpowiadać, uruchom z <code>--read-only</code>.',
    howH2: 'Jak to działa',
    howIntro: 'Trzy kroki i nigdzie po drodze żadnego konta.',
    steps: [
      [
        'Utwórz swój klucz',
        'Aplikacja tworzy twoją tożsamość na urządzeniu i pokazuje 24 słowa odzyskiwania. Zapisz je.'
      ],
      [
        'Załóż tablicę i wyślij zaproszenie',
        'Wyślij link albo pokaż kod QR. Każdy, kto ma zaproszenie, otworzy&nbsp;tablicę.'
      ],
      [
        'Urządzenia łączą się bezpośrednio',
        'Członkowie znajdują się przez wspólną sieć i łączą szyfrowanymi połączeniami. Nikt nie pośredniczy w ruchu.'
      ]
    ],
    howNote:
      '<strong>Cena za brak serwera:</strong> żeby się zsynchronizować, dwie osoby muszą być online w tym samym czasie. Żeby wypełnić luki, trzymaj jedno urządzenie zawsze włączone: stary laptop z <code>opencollab watch</code> albo przekaźnik, który trzyma tylko zaszyfrowaną kopię.',
    getH2: 'Pobierz OpenCollab',
    get: [
      [
        'Telefon',
        `<p>Po polsku i angielsku.</p><ul class="plain"><li><strong>Android:</strong> <a href="${REPO}/releases?q=android-v&amp;expanded=true">pobierz APK</a> (Android 10 lub nowszy)</li><li><strong>iPhone:</strong> zbuduj z <a href="${REPO}/tree/main/apps/mobile">apps/mobile</a></li><li>Potem oba aktualizują się przez Pear</li></ul>`
      ],
      [
        'Komputer',
        'macOS, Windows i Linux. Instaluje się od innych peerów przez Pear i sam się aktualizuje.',
        `npx pear install ${DESKTOP_LINK}`
      ],
      [
        'Wiersz poleceń i agenci',
        'Czytaj i zmieniaj tablice z terminala, trzymaj urządzenie online albo podłącz klienta AI przez <code>opencollab mcp</code>.',
        `npx pear install --to ~/.local/share ${CLI_LINK}`
      ]
    ],
    getNote:
      'Instalacja przez Pear wymaga <a href="https://nodejs.org">Node.js</a> i co najmniej jednego urządzenia online z tym wydaniem.',
    faqH2: 'FAQ',
    faqIntro: 'Pytania, które padają, zanim ktoś zaufa tablicy bez serwera.',
    faq: [
      [
        'Gdzie jest moja tablica, skoro nie ma serwera?',
        'Na urządzeniu każdego członka. Każde trzyma pełną kopię jako podpisany dziennik na osobę, scalane w jedną tablicę. Urządzenie otwiera własną kopię, więc tablica działa offline. Synchronizacja wysyła tylko to, czego brakuje drugiej stronie.'
      ],
      [
        'Jak urządzenia się znajdują?',
        'Przez wspólną sieć wyszukiwania (DHT), którą współtworzy każda działająca aplikacja Holepunch. Członkowie ogłaszają się pod kodem wyliczonym z klucza tablicy. Sieć widzi ten kod, nigdy klucz.'
      ],
      [
        'A jeśli oboje jesteśmy za domowymi routerami?',
        'Oba urządzenia poznają swój publiczny adres i wysyłają do siebie pakiety w tej samej chwili, więc oba routery otwierają drogę (hole punching). Niektóre restrykcyjne sieci to blokują. Wtedy pomaga przekaźnik z publicznym adresem.'
      ],
      [
        'Kto może czytać moją tablicę?',
        'Osoby i agenci, którzy mają zaproszenie. Zaproszenie zawiera klucz tablicy. Wszystko na tablicy jest szyfrowane kluczami z niego wyprowadzonymi (XSalsa20-Poly1305, przez libsodium).'
      ],
      [
        'Czy agent AI może czytać moje tablice?',
        'Tylko te, na które go zaprosisz, dokładnie jak człowieka. Widać go w Członkach i traci dostęp, gdy go usuniesz. Każdy na tablicy może napisać tekst, który agent przeczyta, dlatego OpenCollab każe modelowi traktować karty i komentarze jako treść, nigdy jako polecenia.'
      ],
      [
        'Co Enricher, agent od najważniejszych punktów, wysyła na zewnątrz?',
        'Działa na twoim komputerze. Żeby przeczytać post, wysyła link do usługi transkrypcji, a potem tekst i komentarze karty do modelu AI, który ustawisz. Pozostałe tablice nie opuszczają twoich urządzeń. Nie zapraszaj go na tablice, które wolicie zachować dla siebie.'
      ],
      [
        'Dwie osoby zmieniły tę samą kartę offline. Kto wygrywa?',
        'W każdym polu wygrywa najnowsza zmiana, a remisy są rozstrzygane tak samo na każdym urządzeniu. Komentarze, głosy i zdjęcia tylko się dodają, więc nic nie ginie.'
      ],
      [
        'Co, jeśli zgubię telefon?',
        'Wpisz 24 słowa odzyskiwania na nowym urządzeniu i wracasz jako ten sam członek. Bez nich nikt nie odtworzy twojej tożsamości.'
      ]
    ],
    faqMore: `Więcej w <a href="${REPO}/blob/main/docs/faq.md">pełnym FAQ</a> (po angielsku).`,
    stackH2: 'Zbudowane na Holepunch',
    stack:
      'OpenCollab działa na peer-to-peer klockach <a href="https://holepunch.to">Holepunch</a>: <a href="https://docs.pears.com">Pear</a> do dystrybucji i aktualizacji, <a href="https://github.com/holepunchto/bare">Bare</a> jako wspólny backend, <a href="https://github.com/holepunchto/hyperswarm">Hyperswarm</a> do znajdowania peerów, <a href="https://github.com/holepunchto/hypercore">Hypercore</a> i <a href="https://github.com/holepunchto/autobee">Autobee</a> dla podpisanej tablicy z wieloma autorami oraz <a href="https://github.com/holepunchto/hyperblobs">Hyperblobs</a> dla szyfrowanych zdjęć. Każda aplikacja działa na tym samym backendzie.',
    footer: ['System projektowy', 'Polityka prywatności', 'GitHub']
  }
}

const sections = ['privacy', 'groups', 'agents', 'how', 'get', 'faq']
const PLATFORMS = [
  ['b-android', 'Android'],
  ['b-apple', 'iPhone · Mac'],
  ['b-windows', 'Windows'],
  ['b-linux', 'Linux'],
  ['i-terminal', 'Terminal']
]

const icon = (id, className = 'icon') =>
  `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`

// A phone screenshot (src/mock) in two sizes; the browser picks by layout width.
function phone(name, alt, { root, lang, sizes, eager }) {
  const file = `${root}assets/screens/${name}-${lang}`
  return `<img
    src="${file}-390.webp"
    srcset="${file}-200.webp 200w, ${file}-390.webp 390w, ${file}.webp 780w"
    sizes="${sizes}"
    width="780" height="1688"
    ${eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'}
    alt="${alt}" />`
}

// A short looping clip (src/mock): it loads and plays only while on screen.
function clip(name, alt, { root, lang }) {
  const file = `${root}assets/clips/${name}-${lang}`
  return `<video muted loop playsinline preload="none" width="540" height="1168"
    poster="${file}.webp" data-src="${file}.mp4" aria-label="${alt}"></video>`
}

const media = (items, { root, lang, sizes }) =>
  items
    .map(
      ([kind, name, alt]) =>
        `<figure class="shot reveal scale">${kind === 'clip' ? clip(name, alt, { root, lang }) : phone(name, alt, { root, lang, sizes })}</figure>`
    )
    .join('\n          ')

function page(lang) {
  const t = copy[lang]
  const root = lang === 'en' ? '' : '../'
  const url = lang === 'en' ? SITE : `${SITE}pl/`
  const other = lang === 'en' ? 'pl' : 'en'
  const otherHref = lang === 'en' ? 'pl/' : '../'
  const ogImage = `${SITE}assets/og-${lang}.jpg`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenCollab',
    description: t.description,
    url,
    inLanguage: lang,
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Android, iOS, macOS, Windows, Linux',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    codeRepository: REPO,
    image: ogImage
  }

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t.title}</title>
    <meta name="description" content="${t.description}" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" hreflang="en" href="${SITE}" />
    <link rel="alternate" hreflang="pl" href="${SITE}pl/" />
    <link rel="alternate" hreflang="x-default" href="${SITE}" />
    <meta name="theme-color" content="#0a0e14" />
    <meta name="color-scheme" content="dark" />
    <script>document.documentElement.classList.add('js')</script>
    <link rel="icon" href="${root}assets/icon.svg" type="image/svg+xml" />
    <link rel="icon" href="${root}icon.png" sizes="64x64" />
    <link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="OpenCollab" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${t.title}" />
    <meta property="og:description" content="${t.description}" />
    <meta property="og:locale" content="${t.locale}" />
    <meta property="og:locale:alternate" content="${copy[other].locale}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${t.ogAlt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t.title}" />
    <meta name="twitter:description" content="${t.description}" />
    <meta name="twitter:image" content="${ogImage}" />
    <meta name="twitter:image:alt" content="${t.ogAlt}" />
    <link rel="preload" as="font" type="font/woff2" crossorigin href="${root}assets/fonts/plex-latin.woff2" />
    <link rel="preload" as="image" media="(min-width: 641px)" href="${root}assets/screens/desktop-${lang}-800.webp" imagesrcset="${root}assets/screens/desktop-${lang}-800.webp 800w, ${root}assets/screens/desktop-${lang}.webp 1600w" imagesizes="(max-width: 900px) 100vw, 640px" fetchpriority="high" />
    <link rel="preload" as="image" media="(max-width: 640px)" href="${root}assets/screens/feed-${lang}-390.webp" imagesrcset="${root}assets/screens/feed-${lang}-390.webp 390w, ${root}assets/screens/feed-${lang}.webp 780w" imagesizes="100vw" fetchpriority="high" />
    <link rel="stylesheet" href="${root}styles.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body>
    ${sprite}
    <a class="skip" href="#top">${lang === 'en' ? 'Skip to content' : 'Przejdź do treści'}</a>
    <header class="nav">
      <a class="logo" href="${root || './'}" aria-label="OpenCollab"><span class="prompt">&gt;</span> opencollab</a>
      <nav aria-label="${lang === 'en' ? 'Sections' : 'Sekcje'}">
        ${sections.map((id, i) => `<a href="#${id}"${id === 'get' ? ' class="nav-get"' : ''}>${t.nav[i]}</a>`).join('\n        ')}
      </nav>
      <a class="lang" href="${otherHref}" hreflang="${other}" lang="${other}">
        ${icon('i-languages')}<span>${t.switchLabel}</span>
      </a>
    </header>

    <main id="top">
      <section class="hero">
        <h1>${t.h1}</h1>
        <div class="hero-row">
          <div class="hero-copy">
            <p class="lead">${t.lead}</p>
            <div class="actions">
              <a class="button primary" href="#get">${t.ctaGet}</a>
              <a class="button" href="#privacy">${t.ctaPrivacy}</a>
            </div>
            <ul class="platforms" aria-label="${t.platformsLabel}">
              ${PLATFORMS.map(([id, name]) => `<li>${icon(id, 'brand')}<span>${name}</span></li>`).join('\n              ')}
            </ul>
          </div>

          <div class="hero-shot">
            <picture>
              <source
                media="(max-width: 640px)"
                srcset="${root}assets/screens/feed-${lang}-390.webp 390w, ${root}assets/screens/feed-${lang}.webp 780w"
                sizes="100vw"
                width="780"
                height="1688"
              />
              <img
                class="desk"
                src="${root}assets/screens/desktop-${lang}-800.webp"
                srcset="${root}assets/screens/desktop-${lang}-800.webp 800w, ${root}assets/screens/desktop-${lang}.webp 1600w"
                sizes="(max-width: 900px) 100vw, 640px"
                width="1600"
                height="1000"
                fetchpriority="high"
                alt="${t.heroAlt}"
              />
            </picture>
            <div class="phone">${phone('feed', t.heroPhoneAlt, { root, lang, sizes: '(max-width: 900px) 30vw, 190px' })}</div>
          </div>
        </div>
      </section>

      <section id="privacy" class="section">
        <div class="head">
          <h2 class="reveal">${t.privacyH2}</h2>
          <p class="reveal">${t.privacyIntro}</p>
        </div>
        <div class="who reveal" role="region" aria-label="${t.whoCaption}" tabindex="0">
          <table>
            <caption>${t.whoCaption}</caption>
            <thead>
              <tr><td></td><th scope="col">${t.whoHead[0]}</th><th scope="col">${t.whoHead[1]}</th></tr>
            </thead>
            <tbody>
              ${t.who
                .map(
                  ([who, readClass, read, ipClass, ip]) =>
                    `<tr><th scope="row">${who}</th><td class="${readClass}" data-label="${t.whoHead[0]}">${read}</td><td class="${ipClass}" data-label="${t.whoHead[1]}">${ip}</td></tr>`
                )
                .join('\n              ')}
            </tbody>
          </table>
        </div>
        <ul class="points">
          ${t.privacy.map(([, title, text]) => `<li class="reveal"><h3>${title}</h3><p>${text}</p></li>`).join('\n          ')}
        </ul>
      </section>

      <section id="groups" class="section">
        <div class="head">
          <h2 class="reveal">${t.groupsH2}</h2>
          <p class="reveal">${t.groupsIntro}</p>
        </div>
        <div class="split">
          <ul class="points one">
            ${t.groups.map(([, title, text]) => `<li class="reveal"><h3>${title}</h3><p>${text}</p></li>`).join('\n            ')}
          </ul>
          <div class="media">
            ${media(t.groupsMedia, { root, lang, sizes: '(max-width: 640px) 45vw, (max-width: 900px) 42vw, 290px' })}
          </div>
        </div>
      </section>

      <section id="agents" class="section">
        <div class="head">
          <h2 class="reveal">${t.agentsH2}</h2>
          <p class="reveal">${t.agentsIntro}</p>
        </div>
        <div class="roles">
          ${t.agents
            .map(([, title, text], i) => {
              const [kind, name, alt] = t.agentsMedia[i]
              const picture =
                kind === 'clip'
                  ? clip(name, alt, { root, lang })
                  : phone(name, alt, {
                      root,
                      lang,
                      sizes: '(max-width: 640px) 100vw, (max-width: 900px) 45vw, 340px'
                    })
              return `<figure class="shot reveal scale">
            ${picture}
            <figcaption><h3>${title}</h3><p>${text}</p></figcaption>
          </figure>`
            })
            .join('\n          ')}
        </div>
        <div class="build reveal">
          <div>
            <h3>${t.buildH3}</h3>
            <p>${t.buildText}</p>
          </div>
          <pre><code>${t.buildCode.join('\n')}</code></pre>
        </div>
        <p class="note reveal">${t.agentsNote}</p>
      </section>

      <section id="how" class="section">
        <div class="head">
          <h2 class="reveal">${t.howH2}</h2>
          <p class="reveal">${t.howIntro}</p>
        </div>
        <ol class="steps">
          ${t.steps.map(([title, text]) => `<li class="reveal"><h3>${title}</h3><p>${text}</p></li>`).join('\n          ')}
        </ol>
        <p class="note reveal">${t.howNote}</p>
      </section>

      <section id="get" class="section field">
        <div class="head">
          <h2 class="reveal">${t.getH2}</h2>
          <p class="reveal small">${t.getNote}</p>
        </div>
        <div class="rows">
          ${t.get
            .map(
              ([title, text, code]) => `<div class="row reveal">
            <h3>${title}</h3>
            <div>${text.startsWith('<p>') ? text : `<p>${text}</p>`}${code ? `\n            <pre><code>${code}</code></pre>` : ''}</div>
          </div>`
            )
            .join('\n          ')}
        </div>
      </section>

      <section class="section stack">
        <div class="head">
          <h2 class="reveal">${t.stackH2}</h2>
          <p class="reveal">${t.stack}</p>
        </div>
      </section>
      <section id="faq" class="section">
        <div class="head">
          <h2 class="reveal">${t.faqH2}</h2>
          <p class="reveal">${t.faqIntro}</p>
        </div>
        <div class="faq">
          ${t.faq
            .map(
              ([question, answer]) => `<details class="reveal">
            <summary>${question}</summary>
            <p>${answer}</p>
          </details>`
            )
            .join('\n          ')}
        </div>
        <p class="note reveal">${t.faqMore}</p>
      
      </section>

    </main>

    <footer class="footer">
      <span class="logo"><span class="prompt">&gt;</span> opencollab</span>
      <nav aria-label="Footer">
        <a href="${root}design-system.html">${t.footer[0]}</a>
        <a href="${REPO}/blob/main/PRIVACY.md">${t.footer[1]}</a>
        <a href="${REPO}">${t.footer[2]}</a>
      </nav>
    </footer>
    <script>
      // Clips load and play only while on screen; with reduced motion they stay still.
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches
      const watch = new IntersectionObserver(
        (entries) => {
          for (const { target, isIntersecting } of entries) {
            if (isIntersecting && !still) {
              if (!target.src) target.src = target.dataset.src
              target.play().catch(() => {})
            } else target.pause()
          }
        },
        { rootMargin: '200px' }
      )
      document.querySelectorAll('video[data-src]').forEach((video) => watch.observe(video))
      // Each section's parts rise as it comes into view, once.
      const reveal = new IntersectionObserver(
        (entries) => {
          for (const { target, isIntersecting } of entries) {
            if (!isIntersecting) continue
            target.classList.add('in')
            reveal.unobserve(target)
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.1 }
      )
      document.querySelectorAll('.reveal').forEach((el) => reveal.observe(el))
    </script>
  </body>
</html>
`
}

fs.writeFileSync(path.join(here, 'index.html'), page('en'))
fs.mkdirSync(path.join(here, 'pl'), { recursive: true })
fs.writeFileSync(path.join(here, 'pl/index.html'), page('pl'))
fs.writeFileSync(
  path.join(here, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`
)
fs.writeFileSync(
  path.join(here, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[SITE, `${SITE}pl/`]
  .map(
    (loc) => `  <url>
    <loc>${loc}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}" />
    <xhtml:link rel="alternate" hreflang="pl" href="${SITE}pl/" />
  </url>`
  )
  .join('\n')}
</urlset>
`
)
console.log('wrote index.html, pl/index.html, robots.txt, sitemap.xml')

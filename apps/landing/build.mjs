// Builds the landing page in English (index.html) and Polish (pl/index.html),
// and the docs page (docs/, pl/docs/) for everything technical, from one
// template, so the languages stay in step. Edit the copy below, then run:
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
    docsNav: 'Docs',
    switchLabel: 'Polski',
    h1: 'Boards nobody else can read.',
    lead: 'Private boards for friends, family and your agents, free and open source. Your phone encrypts every card before it leaves; nobody in between can read it, including us.',
    ctaGet: 'Get OpenCollab',
    ctaPrivacy: 'See how it stays private',
    platformsLabel: 'Available on',
    platformsLine: 'Android · iPhone · Mac · Windows · Linux · Terminal',
    ctaAndroid: 'Get it for Android',
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
        'Cards, comments, chat and photos are encrypted on your phone before they leave it. Anyone who intercepts them sees noise.'
      ],
      [
        'i-key-round',
        'Only the people you invite',
        'Your invite link is the only way in. Whoever you send it to can read the board. Nobody else can, us included.'
      ],
      [
        'i-server-off',
        'No company cloud',
        'Boards live on your group’s devices, not on our servers. There’s no central copy to leak or sell.'
      ],
      [
        'i-fingerprint',
        'No account',
        'No email, no phone number, no password. You back up your identity as 24 words.'
      ],
      [
        'i-signature',
        'Nobody can fake your edits',
        'Every change carries your signature. Nobody can forge or rewrite it, and a removed member can’t add new ones.'
      ],
      [
        'i-code-xml',
        'Free and open source',
        `No ads and no paid plan. The code is <a href="${REPO}">on GitHub</a> for anyone to check.`
      ]
    ],
    privacyMore:
      'Want the details? Read <a href="docs/#privacy">how the encryption works and who can see what</a>.',
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
    agentsNote:
      '<strong>What an agent can see:</strong> only the boards you invite it to. It sends what it reads to the AI model you chose.',
    agentsMore:
      '<strong>Want your own?</strong> Maybe your group wants a price tracker. Connect Claude, Cursor or another AI app to your boards, or have a developer friend write a small agent. <a href="docs/#agents">Read the agent guide</a>.',
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
        'Your devices sync directly',
        'Changes travel straight between your group’s phones and computers, encrypted the whole way. No company sits in the middle.'
      ]
    ],
    howNote:
      '<strong>The trade-off:</strong> with no server, changes arrive when someone from the group is online. Leave an old laptop on, or set up a small always-on device, and the board is there whenever anyone opens it. <a href="docs/#online">How to keep a board online</a>.',
    getH2: 'Get OpenCollab',
    get: [
      [
        'Phone',
        `<p>In English and Polish.</p><ul class="plain"><li><strong>Android:</strong> <a href="${REPO}/releases?q=android-v&amp;expanded=true">download the APK</a> (Android 10 or newer)</li><li><strong>iPhone:</strong> not in the App Store yet. <a href="${REPO}">Follow progress</a></li><li>Both update themselves</li></ul>`
      ],
      [
        'Desktop',
        'macOS, Windows and Linux. One command installs it, and it updates itself.',
        ['Install guide', 'docs/#install']
      ],
      [
        'For developers',
        'Read and edit boards from a terminal, keep a board online, or connect an AI app.',
        ['Developer docs', 'docs/#agents']
      ]
    ],
    getNote: 'Free on every platform. No account, no sign-up.',
    faqH2: 'FAQ',
    faqIntro: 'What people ask before they move their group onto a board.',
    faq: [
      [
        'Do my friends need an account?',
        'No. They install the app, tap your invite and pick a name. Nobody signs up anywhere.'
      ],
      [
        'Who can read my board?',
        'Only the people and agents you invite. Not us, not your internet provider, not anyone who intercepts the traffic.'
      ],
      [
        'Can an AI agent read my boards?',
        'Only the boards you invite it to, exactly like a person. It shows up in Members and loses access when you remove it.'
      ],
      [
        'What does Enricher, the key points agent, send outside?',
        'It runs on your computer. To read a post, it sends the link to a transcript service and the text to the AI model you chose. Your other boards stay on your devices. Leave it off boards you’d rather keep to yourselves.'
      ],
      [
        'Does it work offline?',
        'Yes. Add and edit on the train. Your changes sync the next time you and someone from the board are online.'
      ],
      [
        'Two people edited the same card. What happens?',
        'The newest change to each field wins, the same way on every device. Comments, votes and photos only add up, so nothing gets lost.'
      ],
      [
        'What if I lose my phone?',
        'Enter your 24 recovery words on a new device and you’re back as the same member. Without them nobody can restore your identity.'
      ],
      [
        'Is it really free?',
        'Yes. There’s no server for us to pay for, so there’s no subscription and no ads.'
      ]
    ],
    faqMore:
      'Technical questions, like how devices find each other? <a href="docs/">Read the docs</a>.',
    footer: ['Design system', 'Docs', 'Privacy policy', 'GitHub']
  },

  pl: {
    locale: 'pl_PL',
    title: 'OpenCollab: szyfrowane tablice dla znajomych i agentów AI',
    description:
      'Dziel się linkami, listami i planami ze znajomymi i agentami AI na tablicach, które czytacie tylko wy. Szyfrowanie end-to-end, bez konta i bez serwera. Darmowe i open source.',
    ogAlt: 'OpenCollab: prywatne tablice dla znajomych, rodziny i twoich agentów',
    nav: ['Prywatność', 'Dla grup', 'Agenci', 'Jak to działa', 'Pobierz', 'FAQ'],
    docsNav: 'Dokumentacja',
    switchLabel: 'English',
    h1: 'Tablice, których nikt nie podejrzy.',
    lead: 'Prywatne tablice dla znajomych, rodziny i twoich agentów, darmowe i open source. Telefon szyfruje każdą kartę, zanim ją wyśle; nikt po drodze jej nie przeczyta, my też nie.',
    ctaGet: 'Pobierz OpenCollab',
    ctaPrivacy: 'Zobacz, jak chronimy prywatność',
    platformsLabel: 'Dostępne na',
    platformsLine: 'Android · iPhone · Mac · Windows · Linux · Terminal',
    ctaAndroid: 'Pobierz na Androida',
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
        'Karty, komentarze, czat i zdjęcia są szyfrowane na telefonie, zanim go opuszczą. Kto je przechwyci, zobaczy szum.'
      ],
      [
        'i-key-round',
        'Tylko osoby, które zaprosisz',
        'Link z zaproszeniem to jedyne wejście. Kto go dostanie, przeczyta tablicę. Nikt inny, my też nie.'
      ],
      [
        'i-server-off',
        'Bez firmowej chmury',
        'Tablice są na urządzeniach twojej grupy, nie na naszych serwerach. Nie ma centralnej kopii, która mogłaby wyciec albo zostać sprzedana.'
      ],
      [
        'i-fingerprint',
        'Bez konta',
        'Bez e-maila, numeru telefonu i hasła. Tożsamość zapisujesz jako 24 słowa.'
      ],
      [
        'i-signature',
        'Nikt nie podrobi twoich zmian',
        'Każda zmiana ma twój podpis. Nikt jej nie podrobi ani nie przepisze, a usunięta osoba nie doda nowych.'
      ],
      [
        'i-code-xml',
        'Darmowe i open source',
        `Bez reklam i płatnych planów. Kod jest <a href="${REPO}">na GitHubie</a>, każdy może go sprawdzić.`
      ]
    ],
    privacyMore:
      'Chcesz szczegółów? Przeczytaj, <a href="docs/#privacy">jak działa szyfrowanie i kto co widzi</a>.',
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
    agentsNote:
      '<strong>Co widzi agent:</strong> tylko tablice, na które go zaprosisz. To, co przeczyta, wysyła do modelu AI, który wybierzesz.',
    agentsMore:
      '<strong>Chcesz własnego?</strong> Może twoja grupa chce śledzić ceny. Podłącz do tablic Claude’a, Cursora albo inną aplikację AI, albo poproś znajomego programistę o małego agenta. <a href="docs/#agents">Przeczytaj przewodnik po agentach</a>.',
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
        'Urządzenia synchronizują się bezpośrednio',
        'Zmiany wędrują prosto między telefonami i komputerami twojej grupy, zaszyfrowane przez całą drogę. Żadna firma nie stoi pośrodku.'
      ]
    ],
    howNote:
      '<strong>Cena za brak serwera:</strong> zmiany docierają, gdy ktoś z grupy jest online. Zostaw włączony stary laptop albo małe urządzenie, które działa cały czas, a tablica będzie dostępna zawsze, gdy ktoś ją otworzy. <a href="docs/#online">Jak trzymać tablicę online</a>.',
    getH2: 'Pobierz OpenCollab',
    get: [
      [
        'Telefon',
        `<p>Po polsku i angielsku.</p><ul class="plain"><li><strong>Android:</strong> <a href="${REPO}/releases?q=android-v&amp;expanded=true">pobierz APK</a> (Android 10 lub nowszy)</li><li><strong>iPhone:</strong> jeszcze nie w App Store. <a href="${REPO}">Śledź postępy</a></li><li>Oba same się aktualizują</li></ul>`
      ],
      [
        'Komputer',
        'macOS, Windows i Linux. Instaluje się jednym poleceniem i sam się aktualizuje.',
        ['Instrukcja instalacji', 'docs/#install']
      ],
      [
        'Dla programistów',
        'Czytaj i zmieniaj tablice z terminala, trzymaj tablicę online albo podłącz aplikację AI.',
        ['Dokumentacja dla programistów', 'docs/#agents']
      ]
    ],
    getNote: 'Darmowe na każdej platformie. Bez konta i bez rejestracji.',
    faqH2: 'FAQ',
    faqIntro: 'O to pytają ludzie, zanim przeniosą swoją grupę na tablicę.',
    faq: [
      [
        'Czy znajomi potrzebują konta?',
        'Nie. Instalują aplikację, klikają zaproszenie i wybierają imię. Nikt nigdzie się nie rejestruje.'
      ],
      [
        'Kto może czytać moją tablicę?',
        'Tylko osoby i agenci, których zaprosisz. Nie my, nie twój dostawca internetu i nie ktoś, kto przechwyci ruch.'
      ],
      [
        'Czy agent AI może czytać moje tablice?',
        'Tylko te, na które go zaprosisz, dokładnie jak człowieka. Widać go w Członkach i traci dostęp, gdy go usuniesz.'
      ],
      [
        'Co Enricher, agent od najważniejszych punktów, wysyła na zewnątrz?',
        'Działa na twoim komputerze. Żeby przeczytać post, wysyła link do usługi transkrypcji, a tekst do modelu AI, który wybierzesz. Pozostałe tablice zostają na twoich urządzeniach. Nie zapraszaj go na tablice, które wolicie zachować dla siebie.'
      ],
      [
        'Czy działa offline?',
        'Tak. Dodawaj i zmieniaj w pociągu. Zmiany zsynchronizują się, gdy ty i ktoś z tablicy będziecie online.'
      ],
      [
        'Dwie osoby zmieniły tę samą kartę. Co wtedy?',
        'W każdym polu wygrywa najnowsza zmiana, tak samo na każdym urządzeniu. Komentarze, głosy i zdjęcia tylko się dodają, więc nic nie ginie.'
      ],
      [
        'Co, jeśli zgubię telefon?',
        'Wpisz 24 słowa odzyskiwania na nowym urządzeniu i wracasz jako ten sam członek. Bez nich nikt nie odtworzy twojej tożsamości.'
      ],
      [
        'Czy to naprawdę darmowe?',
        'Tak. Nie mamy serwera, za który trzeba płacić, więc nie ma abonamentu ani reklam.'
      ]
    ],
    faqMore:
      'Pytania techniczne, na przykład jak urządzenia się znajdują? <a href="docs/">Przeczytaj dokumentację</a>.',
    footer: ['System projektowy', 'Dokumentacja', 'Polityka prywatności', 'GitHub']
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
    <script>
      document.documentElement.classList.add('js')
      // Language: a remembered choice (the switch sets it) wins; otherwise a Polish
      // browser arriving at the English page is sent to /pl/ once. A direct link
      // to /pl/ is respected. Without script, hreflang alone does the work.
      ;(function () {
        try {
          var here = '${lang}', other = '${other}', to = '${otherHref}'
          var chosen = localStorage.getItem('opencollab.lang')
          var go = chosen ? chosen === other : here === 'en' &&
              ((navigator.languages || [navigator.language])[0] || '').slice(0, 2).toLowerCase() === 'pl'
          if (go) location.replace(to + location.hash)
        } catch (e) {}
      })()
    </script>
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
        <a href="docs/">${t.docsNav}</a>
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
              <a class="button primary" href="#get" data-android="${REPO}/releases?q=android-v&amp;expanded=true">${t.ctaGet}</a>
              <a class="button" href="#privacy">${t.ctaPrivacy}</a>
            </div>
            <ul class="platforms" aria-label="${t.platformsLabel}">
              ${PLATFORMS.map(([id, name]) => `<li>${icon(id, 'brand')}<span>${name}</span></li>`).join('\n              ')}
            </ul>
            <p class="platforms-line">${t.platformsLine}</p>
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
        <ul class="points">
          ${t.privacy.map(([, title, text], i) => `<li class="reveal${[2, 4].includes(i) ? ' more' : ''}"><h3>${title}</h3><p>${text}</p></li>`).join('\n          ')}
        </ul>
        <p class="note reveal">${t.privacyMore}</p>
      </section>

      <section id="groups" class="section">
        <div class="head">
          <h2 class="reveal">${t.groupsH2}</h2>
          <p class="reveal">${t.groupsIntro}</p>
        </div>
        <div class="split">
          <ul class="points one">
            ${t.groups.map(([, title, text], i) => `<li class="reveal${[3, 4].includes(i) ? ' more' : ''}"><h3>${title}</h3><p>${text}</p></li>`).join('\n            ')}
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
        <div class="dev reveal">
          <p class="note">${t.agentsNote}</p>
          <p class="note">${t.agentsMore}</p>
        </div>
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
              ([title, text, link]) => `<div class="row reveal">
            <h3>${title}</h3>
            <div>${text.startsWith('<p>') ? text : `<p>${text}</p>`}${link ? `\n            <a class="button" href="${link[1]}">${link[0]}</a>` : ''}</div>
          </div>`
            )
            .join('\n          ')}
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

    <a class="sticky-get" href="#get" data-android="${REPO}/releases?q=android-v&amp;expanded=true" tabindex="-1" aria-hidden="true">${t.ctaGet}</a>
    <footer class="footer">
      <span class="logo"><span class="prompt">&gt;</span> opencollab</span>
      <nav aria-label="Footer">
        <a class="lang" href="${otherHref}" hreflang="${other}" lang="${other}">${t.switchLabel}</a>
        <a class="desk" href="${root}design-system.html">${t.footer[0]}</a>
        <a href="docs/">${t.footer[1]}</a>
        <a href="${REPO}/blob/main/PRIVACY.md">${t.footer[2]}</a>
        <a href="${REPO}">${t.footer[3]}</a>
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
      // The language switch keeps the section you are reading and remembers the choice.
      document.querySelectorAll('a.lang').forEach((link) => {
        link.addEventListener('click', () => {
          try {
            localStorage.setItem('opencollab.lang', link.getAttribute('hreflang'))
          } catch (e) {}
          link.href = link.getAttribute('href') + location.hash
        })
      })
      // Android gets the APK straight from the first button.
      if (/Android/i.test(navigator.userAgent)) {
        document.querySelectorAll('a[data-android]').forEach((a) => {
          a.href = a.dataset.android
          a.textContent = '${t.ctaAndroid}'
        })
      }
      // On phones one Get button stays within reach once the hero's has scrolled away,
      // and steps aside at the Get section and the footer.
      const sticky = document.querySelector('.sticky-get')
      if (sticky) {
        let heroGone = false
        let nearGet = false
        const show = () => sticky.classList.toggle('show', heroGone && !nearGet)
        new IntersectionObserver(([e]) => {
          heroGone = !e.isIntersecting && e.boundingClientRect.top < 0
          show()
        }).observe(document.querySelector('.hero .actions'))
        const near = new IntersectionObserver((entries) => {
          for (const e of entries) e.target.dataset.near = e.isIntersecting ? '1' : ''
          nearGet = [...document.querySelectorAll('#get, .footer')].some((el) => el.dataset.near)
          show()
        })
        near.observe(document.querySelector('#get'))
        near.observe(document.querySelector('.footer'))
      }
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

// The docs page: everything technical the landing page leaves out. Same
// header, footer and styles; published at docs/ and pl/docs/.
const docs = {
  en: {
    title: 'OpenCollab docs: how it works, install, agents',
    description:
      'How OpenCollab stores, encrypts and syncs boards without a server, how to install the desktop app and the command line, and how to connect AI agents.',
    h1: 'Docs',
    lead: 'How OpenCollab works under the hood, how to install it on a computer, and how to connect agents. For what it does and who it’s for, see the <a href="../">home page</a>.',
    tocLabel: 'On this page',
    whoCaption: 'Who can see what',
    whoHead: ['Can read your boards', 'Sees your IP address'],
    who: [
      ['People you invite', '', 'Yes', '', 'When connected to you'],
      ['Agents you invite', '', 'Yes, like any member', '', 'When connected to you'],
      ['A relay you run (optional)', 'no', 'No, it holds an encrypted copy', '', 'Yes'],
      ['The network that introduces devices', 'no', 'No', '', 'Yes'],
      ['OpenCollab developers', 'no', 'No', 'no', 'No']
    ],
    sections: [
      [
        'storage',
        'Where boards live',
        `<p>On every member’s device. Each keeps a full copy as a signed log per member, merged into one board. Your device opens its own copy, so the board works offline. Syncing sends only what the other side is missing.</p>
<p>When two people edit the same card offline, the newest change to each field wins, with ties broken the same way on every device. Comments, votes and photos only add, so nothing gets lost.</p>`
      ],
      [
        'privacy',
        'Encryption and identity',
        `<p>The invite link carries the board’s key. Everything on the board, photos included, is encrypted with keys derived from it (XSalsa20-Poly1305, via libsodium). Whoever holds the invite can read the board; the network that connects devices never sees the key.</p>
<p>Your identity is a key pair your device creates. You back it up as 24 recovery words, and entering them on a new device brings you back as the same member. Your device signs every change with this key, so nobody can forge or rewrite your edits, and a removed member’s new changes are ignored.</p>
WHO_TABLE`
      ],
      [
        'network',
        'How devices find each other',
        `<p>Through a shared lookup network (a DHT) that every running Holepunch app helps run. Members announce themselves under a code derived from the board’s key. The network sees that code, never the key.</p>
<p>Two devices behind home routers learn their public addresses and send packets to each other at the same moment, so both routers open a path (hole punching). A few strict networks block this. A relay with a public address bridges the gap.</p>`
      ],
      [
        'online',
        'Keeping a board online',
        `<p>With no server, two members need to be online at the same time to sync. To fill the gaps, keep one device always on:</p>
<ul>
<li><strong>A computer of yours</strong> running the command line as a member of the board:</li>
</ul>
<pre><code>opencollab watch</code></pre>
<ul>
<li><strong>A blind peer</strong>: a relay on a server that keeps an encrypted copy of the board online. It can’t read the board. <a href="${REPO}/blob/main/docs/server.md">Run one on a server</a>.</li>
</ul>`
      ],
      [
        'install',
        'Install',
        `<p><strong>Desktop</strong> (macOS, Windows, Linux). The app installs from peers through Pear and updates itself:</p>
<pre><code>npx pear install ${DESKTOP_LINK}</code></pre>
<p><strong>Command line</strong>, for scripts, agents and keeping a board online:</p>
<pre><code>npx pear install --to ~/.local/share ${CLI_LINK}</code></pre>
<p>Both need <a href="https://nodejs.org">Node.js</a>, and at least one device online that has the release.</p>
<p><strong>Android:</strong> <a href="${REPO}/releases?q=android-v&amp;expanded=true">download the APK</a> (Android 10 or newer). <strong>iPhone:</strong> not in the App Store yet; <a href="${REPO}/tree/main/apps/mobile">build it from source</a>. Both update over Pear afterwards.</p>`
      ],
      [
        'agents',
        'Agents and the command line',
        `<p>An agent is a member that runs on your computer. It joins with an invite and sees only the boards it was invited to. Connect any MCP client, like Claude or Cursor, or run a small worker with the <code>opencollab</code> command line:</p>
<pre><code># connect an AI client
claude mcp add opencollab -e OPENCOLLAB_PASSWORD=… -- opencollab mcp -s ~/.opencollab-ai

# or run a worker: this one turns shared links into key points
SLIDES_BOARD="Weekend reading" node apps/cli/examples/feed-slides.mjs</code></pre>
<p><a href="${REPO}/tree/main/apps/cli/examples">The example agents</a> are a few dozen lines each. For an assistant that should only answer, run it with <code>--read-only</code>.</p>
<p>Anyone on a board can write text the agent reads, so OpenCollab tells the model to treat cards and comments as content, never as instructions. Enricher, the key points agent, sends a post’s link to a transcript service, then the text and the card’s comments to the AI model you configure. <a href="${REPO}/tree/main/apps/cli">The command line reference</a> lists every command.</p>`
      ],
      [
        'stack',
        'Built on Holepunch',
        `<p>OpenCollab runs on <a href="https://holepunch.to">Holepunch</a>’s peer-to-peer building blocks: <a href="https://docs.pears.com">Pear</a> for delivery and updates, <a href="https://github.com/holepunchto/bare">Bare</a> for the shared backend, <a href="https://github.com/holepunchto/hyperswarm">Hyperswarm</a> for finding peers, <a href="https://github.com/holepunchto/hypercore">Hypercore</a> and <a href="https://github.com/holepunchto/autobee">Autobee</a> for the signed, multi-writer board, and <a href="https://github.com/holepunchto/hyperblobs">Hyperblobs</a> for encrypted photos. Every app runs the same backend.</p>`
      ],
      [
        'more',
        'More',
        `<ul>
<li><a href="${REPO}/blob/main/docs/faq.md">Full FAQ</a></li>
<li><a href="${REPO}/blob/main/docs/server.md">Running OpenCollab on a server</a></li>
<li><a href="${REPO}/blob/main/docs/development.md">Building and releasing the apps</a></li>
<li><a href="${REPO}/blob/main/PRIVACY.md">Privacy policy</a></li>
</ul>`
      ]
    ]
  },

  pl: {
    title: 'Dokumentacja OpenCollab: jak to działa, instalacja, agenci',
    description:
      'Jak OpenCollab przechowuje, szyfruje i synchronizuje tablice bez serwera, jak zainstalować aplikację na komputer i wiersz poleceń oraz jak podłączyć agentów AI.',
    h1: 'Dokumentacja',
    lead: 'Jak OpenCollab działa od środka, jak zainstalować go na komputerze i jak podłączyć agentów. Do czego służy i dla kogo jest, przeczytasz na <a href="../">stronie głównej</a>.',
    tocLabel: 'Na tej stronie',
    whoCaption: 'Kto co widzi',
    whoHead: ['Czyta twoje tablice', 'Widzi twój adres IP'],
    who: [
      ['Osoby, które zaprosisz', '', 'Tak', '', 'Gdy łączą się z tobą'],
      ['Agenci, których zaprosisz', '', 'Tak, jak każdy członek', '', 'Gdy łączą się z tobą'],
      ['Twój przekaźnik (opcjonalny)', 'no', 'Nie, trzyma zaszyfrowaną kopię', '', 'Tak'],
      ['Sieć, która łączy urządzenia', 'no', 'Nie', '', 'Tak'],
      ['Twórcy OpenCollab', 'no', 'Nie', 'no', 'Nie']
    ],
    sections: [
      [
        'storage',
        'Gdzie są tablice',
        `<p>Na urządzeniu każdego członka. Każde trzyma pełną kopię jako podpisany dziennik na osobę, scalane w jedną tablicę. Urządzenie otwiera własną kopię, więc tablica działa offline. Synchronizacja wysyła tylko to, czego brakuje drugiej stronie.</p>
<p>Gdy dwie osoby zmienią tę samą kartę offline, w każdym polu wygrywa najnowsza zmiana, a remisy są rozstrzygane tak samo na każdym urządzeniu. Komentarze, głosy i zdjęcia tylko się dodają, więc nic nie ginie.</p>`
      ],
      [
        'privacy',
        'Szyfrowanie i tożsamość',
        `<p>Link z zaproszeniem zawiera klucz tablicy. Wszystko na tablicy, także zdjęcia, jest szyfrowane kluczami z niego wyprowadzonymi (XSalsa20-Poly1305, przez libsodium). Kto ma zaproszenie, ten przeczyta tablicę; sieć, która łączy urządzenia, nigdy nie widzi klucza.</p>
<p>Twoja tożsamość to para kluczy, którą tworzy twoje urządzenie. Zapisujesz ją jako 24 słowa odzyskiwania, a po wpisaniu ich na nowym urządzeniu wracasz jako ten sam członek. Urządzenie podpisuje tym kluczem każdą zmianę, więc nikt nie podrobi ani nie przepisze twoich zmian, a nowe zmiany usuniętej osoby są pomijane.</p>
WHO_TABLE`
      ],
      [
        'network',
        'Jak urządzenia się znajdują',
        `<p>Przez wspólną sieć wyszukiwania (DHT), którą współtworzy każda działająca aplikacja Holepunch. Członkowie ogłaszają się pod kodem wyliczonym z klucza tablicy. Sieć widzi ten kod, nigdy klucz.</p>
<p>Dwa urządzenia za domowymi routerami poznają swoje publiczne adresy i wysyłają do siebie pakiety w tej samej chwili, więc oba routery otwierają drogę (hole punching). Niektóre restrykcyjne sieci to blokują. Wtedy pomaga przekaźnik z publicznym adresem.</p>`
      ],
      [
        'online',
        'Jak trzymać tablicę online',
        `<p>Bez serwera dwie osoby muszą być online w tym samym czasie, żeby się zsynchronizować. Żeby wypełnić luki, trzymaj jedno urządzenie zawsze włączone:</p>
<ul>
<li><strong>Swój komputer</strong> z wierszem poleceń jako członek tablicy:</li>
</ul>
<pre><code>opencollab watch</code></pre>
<ul>
<li><strong>Ślepy peer</strong>: przekaźnik na serwerze, który trzyma zaszyfrowaną kopię tablicy online. Nie umie jej przeczytać. <a href="${REPO}/blob/main/docs/server.md">Uruchom go na serwerze</a> (po angielsku).</li>
</ul>`
      ],
      [
        'install',
        'Instalacja',
        `<p><strong>Komputer</strong> (macOS, Windows, Linux). Aplikacja instaluje się od innych peerów przez Pear i sama się aktualizuje:</p>
<pre><code>npx pear install ${DESKTOP_LINK}</code></pre>
<p><strong>Wiersz poleceń</strong> do skryptów, agentów i trzymania tablicy online:</p>
<pre><code>npx pear install --to ~/.local/share ${CLI_LINK}</code></pre>
<p>Oba wymagają <a href="https://nodejs.org">Node.js</a> i co najmniej jednego urządzenia online z tym wydaniem.</p>
<p><strong>Android:</strong> <a href="${REPO}/releases?q=android-v&amp;expanded=true">pobierz APK</a> (Android 10 lub nowszy). <strong>iPhone:</strong> jeszcze nie w App Store; <a href="${REPO}/tree/main/apps/mobile">zbuduj ze źródeł</a>. Potem oba aktualizują się przez Pear.</p>`
      ],
      [
        'agents',
        'Agenci i wiersz poleceń',
        `<p>Agent to członek tablicy, który działa na twoim komputerze. Dołącza z zaproszeniem i widzi tylko tablice, na które go zaproszono. Podłącz dowolnego klienta MCP, na przykład Claude’a albo Cursora, albo uruchom małego workera z wierszem poleceń <code>opencollab</code>:</p>
<pre><code># podłącz klienta AI
claude mcp add opencollab -e OPENCOLLAB_PASSWORD=… -- opencollab mcp -s ~/.opencollab-ai

# albo uruchom workera: ten zamienia udostępnione linki w najważniejsze punkty
SLIDES_BOARD="Weekend reading" node apps/cli/examples/feed-slides.mjs</code></pre>
<p><a href="${REPO}/tree/main/apps/cli/examples">Przykładowi agenci</a> mają po kilkadziesiąt linijek. Asystenta, który ma tylko odpowiadać, uruchom z <code>--read-only</code>.</p>
<p>Każdy na tablicy może napisać tekst, który agent przeczyta, dlatego OpenCollab każe modelowi traktować karty i komentarze jako treść, nigdy jako polecenia. Enricher, agent od najważniejszych punktów, wysyła link do posta do usługi transkrypcji, a potem tekst i komentarze karty do modelu AI, który ustawisz. <a href="${REPO}/tree/main/apps/cli">Opis wiersza poleceń</a> (po angielsku) wymienia wszystkie polecenia.</p>`
      ],
      [
        'stack',
        'Zbudowane na Holepunch',
        `<p>OpenCollab działa na peer-to-peer klockach <a href="https://holepunch.to">Holepunch</a>: <a href="https://docs.pears.com">Pear</a> do dystrybucji i aktualizacji, <a href="https://github.com/holepunchto/bare">Bare</a> jako wspólny backend, <a href="https://github.com/holepunchto/hyperswarm">Hyperswarm</a> do znajdowania peerów, <a href="https://github.com/holepunchto/hypercore">Hypercore</a> i <a href="https://github.com/holepunchto/autobee">Autobee</a> dla podpisanej tablicy z wieloma autorami oraz <a href="https://github.com/holepunchto/hyperblobs">Hyperblobs</a> dla szyfrowanych zdjęć. Każda aplikacja działa na tym samym backendzie.</p>`
      ],
      [
        'more',
        'Więcej',
        `<p>Po angielsku:</p>
<ul>
<li><a href="${REPO}/blob/main/docs/faq.md">Pełne FAQ</a></li>
<li><a href="${REPO}/blob/main/docs/server.md">OpenCollab na serwerze</a></li>
<li><a href="${REPO}/blob/main/docs/development.md">Budowanie i wydawanie aplikacji</a></li>
<li><a href="${REPO}/blob/main/PRIVACY.md">Polityka prywatności</a></li>
</ul>`
      ]
    ]
  }
}

function whoTable(d) {
  return `<div class="who" role="region" aria-label="${d.whoCaption}" tabindex="0">
<table>
<caption>${d.whoCaption}</caption>
<thead><tr><td></td><th scope="col">${d.whoHead[0]}</th><th scope="col">${d.whoHead[1]}</th></tr></thead>
<tbody>
${d.who
  .map(
    ([who, readClass, read, ipClass, ip]) =>
      `<tr><th scope="row">${who}</th><td class="${readClass}" data-label="${d.whoHead[0]}">${read}</td><td class="${ipClass}" data-label="${d.whoHead[1]}">${ip}</td></tr>`
  )
  .join('\n')}
</tbody>
</table>
</div>`
}

function docsPage(lang) {
  const t = copy[lang]
  const d = docs[lang]
  const other = lang === 'en' ? 'pl' : 'en'
  // docs/ and pl/docs/: the site root is one or two levels up.
  const root = lang === 'en' ? '../' : '../../'
  const url = lang === 'en' ? `${SITE}docs/` : `${SITE}pl/docs/`
  const otherHref = lang === 'en' ? '../pl/docs/' : '../../docs/'
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${d.title}</title>
    <meta name="description" content="${d.description}" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" hreflang="en" href="${SITE}docs/" />
    <link rel="alternate" hreflang="pl" href="${SITE}pl/docs/" />
    <link rel="alternate" hreflang="x-default" href="${SITE}docs/" />
    <meta name="theme-color" content="#0a0e14" />
    <meta name="color-scheme" content="dark" />
    <script>
      // A language chosen with the switch on any page is kept here too.
      ;(function () {
        try {
          var chosen = localStorage.getItem('opencollab.lang')
          if (chosen && chosen === '${other}') location.replace('${otherHref}' + location.hash)
        } catch (e) {}
      })()
    </script>
    <link rel="icon" href="${root}assets/icon.svg" type="image/svg+xml" />
    <link rel="icon" href="${root}icon.png" sizes="64x64" />
    <link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="OpenCollab" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${d.title}" />
    <meta property="og:description" content="${d.description}" />
    <meta property="og:image" content="${SITE}assets/og-${lang}.jpg" />
    <link rel="preload" as="font" type="font/woff2" crossorigin href="${root}assets/fonts/plex-latin.woff2" />
    <link rel="stylesheet" href="${root}styles.css" />
  </head>
  <body class="docs">
    ${sprite}
    <a class="skip" href="#top">${lang === 'en' ? 'Skip to content' : 'Przejdź do treści'}</a>
    <header class="nav">
      <a class="logo" href="../" aria-label="OpenCollab"><span class="prompt">&gt;</span> opencollab</a>
      <nav aria-label="${lang === 'en' ? 'Site' : 'Strona'}">
        <a href="../#get" class="nav-get">${t.nav[4]}</a>
      </nav>
      <a class="lang" href="${otherHref}" hreflang="${other}" lang="${other}">
        ${icon('i-languages')}<span>${t.switchLabel}</span>
      </a>
    </header>

    <main id="top">
      <section class="doc-intro">
        <h1>${d.h1}</h1>
        <p class="lead">${d.lead}</p>
        <nav class="toc" aria-label="${d.tocLabel}">
          <ul>
            ${d.sections.map(([id, title]) => `<li><a href="#${id}">${title}</a></li>`).join('\n            ')}
          </ul>
        </nav>
      </section>
      ${d.sections
        .map(
          ([id, title, body]) => `<section id="${id}" class="section doc">
        <h2>${title}</h2>
        <div class="doc-body">
${body.replace('WHO_TABLE', whoTable(d))}
        </div>
      </section>`
        )
        .join('\n      ')}
    </main>

    <footer class="footer">
      <span class="logo"><span class="prompt">&gt;</span> opencollab</span>
      <nav aria-label="Footer">
        <a class="lang" href="${otherHref}" hreflang="${other}" lang="${other}">${t.switchLabel}</a>
        <a href="../">${lang === 'en' ? 'Home' : 'Strona główna'}</a>
        <a href="${REPO}/blob/main/PRIVACY.md">${t.footer[2]}</a>
        <a href="${REPO}">${t.footer[3]}</a>
      </nav>
    </footer>
    <script>
      // The language switch keeps the section you are reading and remembers the choice.
      document.querySelectorAll('a.lang').forEach((link) => {
        link.addEventListener('click', () => {
          try {
            localStorage.setItem('opencollab.lang', link.getAttribute('hreflang'))
          } catch (e) {}
          link.href = link.getAttribute('href') + location.hash
        })
      })
    </script>
  </body>
</html>
`
}

fs.writeFileSync(path.join(here, 'index.html'), page('en'))
fs.mkdirSync(path.join(here, 'docs'), { recursive: true })
fs.writeFileSync(path.join(here, 'docs/index.html'), docsPage('en'))
fs.mkdirSync(path.join(here, 'pl'), { recursive: true })
fs.writeFileSync(path.join(here, 'pl/index.html'), page('pl'))
fs.mkdirSync(path.join(here, 'pl/docs'), { recursive: true })
fs.writeFileSync(path.join(here, 'pl/docs/index.html'), docsPage('pl'))
fs.writeFileSync(
  path.join(here, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`
)
fs.writeFileSync(
  path.join(here, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${['', 'docs/']
  .flatMap((page) => [
    [`${SITE}${page}`, page],
    [`${SITE}pl/${page}`, page]
  ])
  .map(
    ([loc, page]) => `  <url>
    <loc>${loc}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${page}" />
    <xhtml:link rel="alternate" hreflang="pl" href="${SITE}pl/${page}" />
  </url>`
  )
  .join('\n')}
</urlset>
`
)
console.log(
  'wrote index.html, pl/index.html, docs/index.html, pl/docs/index.html, robots.txt, sitemap.xml'
)

// Polish strings for the board area; see ./index.ts.
// Keys stay quoted so scripts/check-translations.mjs finds them.
// prettier-ignore
const pl: Record<string, string> = {
  // Board types (board-protocol/kinds.js), shown via t(kind.name) / t(kind.description)
  'Kanban': 'Kanban',
  'Columns for work in progress, with checklists, due dates and people.':
    'Kolumny na bieżącą pracę, z checklistami, terminami i osobami.',
  'To-do list': 'Lista zadań',
  'One list to tick off. Done items fold away.':
    'Jedna lista do odhaczania. Zrobione zadania same się chowają.',
  'Feed': 'Aktualności',
  'Posts, links and photos, newest first.': 'Posty, linki i zdjęcia, od najnowszych.',
  'Recipes': 'Przepisy',
  'Photos and how-tos, sorted into meals.': 'Zdjęcia i instrukcje, podzielone na posiłki.',

  // Agenda groups (model.ts agendaGroup), shown via t(section.name)
  'Overdue': 'Po terminie',
  'Today': 'Dzisiaj',
  'This week': 'W tym tygodniu',
  'Later': 'Później',
  'No date': 'Bez terminu',
  'No open cards match. Everything is done, or filtered out.':
    'Brak pasujących otwartych kart. Wszystko zrobione albo ukryte przez filtr.',
  'Hide': 'Ukryj',
  'Show': 'Pokaż',

  // Board screen
  'Cancel': 'Anuluj',
  'My work': 'Moje zadania',
  'My work ({n})': 'Moje zadania ({n})',
  'Members': 'Członkowie',
  'Members ({n})': 'Członkowie ({n})',
  'Hide archived ({n})': 'Ukryj zarchiwizowane ({n})',
  'Show archived ({n})': 'Pokaż zarchiwizowane ({n})',
  'Activity': 'Aktywność',
  'Stats': 'Statystyki',
  'Rules': 'Reguły',
  'Rules ({n})': 'Reguły ({n})',
  'Switch to {kind}?': 'Zmienić na: {kind}?',
  'Use its sections ({sections})? Columns are renamed in order; empty extra columns are removed.':
    'Użyć jej sekcji ({sections})? Kolumny dostaną nowe nazwy po kolei, a puste nadmiarowe kolumny zostaną usunięte.',
  'Keep my columns': 'Zostaw moje kolumny',
  'Use its sections': 'Użyj jej sekcji',
  'Notifications, {n} unread': 'Powiadomienia, nieprzeczytane: {n}',
  'Open profile and connection details': 'Otwórz profil i szczegóły połączenia',
  '{name} is online': '{name} jest online',
  'You were removed from this board. You can still see it, but your changes are ignored by everyone.':
    'Usunięto cię z tej tablicy. Nadal ją widzisz, ale wszyscy ignorują twoje zmiany.',
  'Board description': 'Opis tablicy',
  '+ Add a board description': '+ Dodaj opis tablicy',
  'Board': 'Tablica',
  'Agenda': 'Terminarz',
  'Assigned to me': 'Przypisane do mnie',
  'Filter': 'Filtr',
  'Filter ({n})': 'Filtr ({n})',
  'More': 'Więcej',
  'More · {n} mine': 'Więcej · moje: {n}',
  'limit {n}': 'limit {n}',
  'over the limit': 'ponad limit',
  'at the limit': 'limit osiągnięty',
  '{n} pts': '{n} pkt',
  'Column options for {column}': 'Opcje kolumny {column}',
  'No cards': 'Brak kart',
  '+ Add a card': '+ Dodaj kartę',
  'Add a card to {column}': 'Dodaj kartę do kolumny {column}',
  'New card with description and images': 'Nowa karta z opisem i zdjęciami',
  'From template…': 'Z szablonu…',
  'Add a column': 'Dodaj kolumnę',
  'Column name': 'Nazwa kolumny',
  'Add column': 'Dodaj kolumnę',
  'Board settings': 'Ustawienia tablicy',
  'Edit board': 'Edytuj tablicę',
  'Board type: {kind}': 'Typ tablicy: {kind}',
  'Labels': 'Etykiety',
  'Customize': 'Wygląd',
  'Automation rules': 'Reguły automatyzacji',
  'Start from a template': 'Zacznij od szablonu',
  'Share menu': 'Menu udostępniania',
  'Board type': 'Typ tablicy',
  'Changes how this board looks for everyone. Nothing is deleted: details a type hides come back when you switch again.':
    'Zmienia wygląd tablicy dla wszystkich. Nic nie zostanie usunięte: to, co dany typ ukrywa, wróci po ponownej zmianie.',
  'Show this board': 'Pokazuj tę tablicę',
  'Show this board when sharing from other apps':
    'Pokazuj tę tablicę przy udostępnianiu z innych aplikacji',
  'Share a link or post from any app and pick OpenCollab to add it here as a card. This setting is only on this device.':
    'Udostępnij link lub post z dowolnej aplikacji i wybierz OpenCollab, żeby dodać go tutaj jako kartę. To ustawienie działa tylko na tym urządzeniu.',
  'New cards go to': 'Nowe karty trafiają do',
  'From template': 'Z szablonu',
  'Adds a copy to {column}: title, description, labels, assignees, points and checklist.':
    'Dodaje kopię do kolumny {column}: tytuł, opis, etykiety, przypisane osoby, punkty i checklistę.',
  'Adds a copy to the column: title, description, labels, assignees, points and checklist.':
    'Dodaje kopię do kolumny: tytuł, opis, etykiety, przypisane osoby, punkty i checklistę.',
  'New card from {template}': 'Nowa karta z szablonu {template}',
  'Edit template {template}': 'Edytuj szablon {template}',
  'Edit': 'Edytuj',
  'What is this board for? Markdown works.': 'Do czego służy ta tablica? Możesz używać Markdown.',
  'Everyone on the board sees it.': 'Widzą go wszyscy na tablicy.',
  'Save': 'Zapisz',
  'Close': 'Zamknij',

  // Feed
  'Share something…': 'Podziel się czymś…',
  'No posts yet. Write one, or share a link from any app and pick this board.':
    'Nie ma jeszcze postów. Napisz coś albo udostępnij link z dowolnej aplikacji i wybierz tę tablicę.',

  // My work
  'Checking your boards…': 'Sprawdzam twoje tablice…',
  'Nothing is assigned to you on any board.': 'Nie masz nic przypisanego na żadnej tablicy.',
  'open': 'otwarta',
  'blocked': 'zablokowana',
  'due {date}': 'termin {date}',
  'overdue': 'po terminie',

  // Recipes
  'All': 'Wszystkie',
  'Add a recipe': 'Dodaj przepis',
  'Add a recipe to {section}': 'Dodaj przepis do sekcji {section}',
  'Add to {section}': 'Dodaj do: {section}',
  'Share a recipe from TikTok, Instagram or a website and pick this board, or add one here.':
    'Udostępnij przepis z TikToka, Instagrama lub strony i wybierz tę tablicę albo dodaj go tutaj.',

  // To-do list
  'Open {title}': 'Otwórz: {title}',
  'Add a to-do': 'Dodaj zadanie',
  'All done.': 'Wszystko zrobione.',
  'Nothing to do yet.': 'Na razie nie ma nic do zrobienia.',
  'todo|Done': 'Zrobione'
}

export default pl

import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import { LOCAL } from "../core/nodeRef";
import { buildDocumentRouteUrl } from "../navigationUrl";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  write,
} from "../testFixtures/workspace";
import {
  ALICE,
  expectTree,
  findNewNodeEditor,
  getPane,
  navigateToNodeViaSearch,
  openNodeInFullscreen,
  placeCursorAtEnd,
  renderApp,
  setup,
  type,
} from "../utils.test";
import { clickRow, firePaste } from "./Multiselect.testUtils";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:dunbar@scholarium.at",
  "DTSTART:20300921T180000Z",
  "SUMMARY:Seminar Robin Dunbar",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:sommerfest@scholarium.at",
  "DTSTART;VALUE=DATE:20300714",
  "SUMMARY:Sommerfest",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:archive@scholarium.at",
  "DTSTART;VALUE=DATE:20200101",
  "SUMMARY:Founding seminar",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// Local wall time of the Z instant, mirroring icalEntryDisplayText — keeps
// the expectation timezone-independent.
function dunbarText(): string {
  const date = new Date(Date.UTC(2030, 8, 21, 18, 0, 0));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(
    date.getMonth() + 1
  )}.${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )} Seminar Robin Dunbar`;
}

afterEach(cleanup);

test("a feed line is a read-only row with a plain external link", async () => {
  const [alice] = setup([ALICE]);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  const url =
    "https://calendar.google.com/calendar/ical/67t01k13lbgdntjmoh5pale1kg%40group.calendar.google.com/public/basic.ics";
  renderApp({ ...alice(), fetchCalendarFeed });

  await type(`Salon{Enter}{Tab}${url}{Escape}`);
  const feed = await screen.findByRole("link", {
    name: `${url} (opens externally)`,
  });
  expect(feed.getAttribute("data-href")).toBe(`feed:${url}`);
  expect(feed.getAttribute("href")).toBe(url);
  expect(screen.getByText("↗")).toBeDefined();
  expect(screen.queryByRole("textbox", { name: `edit ${url}` })).toBeNull();
  expect(screen.getByTitle("Calendar").textContent).toBe("🗓︎");
  await userEvent.click(await screen.findByLabelText(`expand ${url}`));

  await screen.findByText("14.07.2030 Sommerfest");
  expect(screen.getAllByTitle("Date")[0].textContent).toBe("📅︎");
  expect(fetchCalendarFeed).toHaveBeenCalledWith(url);
});

test("entries project in feed order, past entries included", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");

  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );
});

test("bare feed urls wrap; the line shows its calendar named by the URL", async () => {
  const [alice] = setup([ALICE]);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  renderApp({ ...alice(), fetchCalendarFeed });

  await type("Salon{Enter}{Tab}webcal://scholarium.at/salon.ics{Escape}");

  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  const feed = screen.getByText("https://scholarium.at/salon.ics", {
    selector: "[data-href]",
  });
  expect(feed.getAttribute("data-href")).toBe(
    "feed:https://scholarium.at/salon.ics"
  );
  expect(screen.queryByText("webcal://scholarium.at/salon.ics")).toBeNull();

  expect(fetchCalendarFeed).toHaveBeenCalledWith(
    "https://scholarium.at/salon.ics"
  );
  expect(fetchCalendarFeed).not.toHaveBeenCalledWith(
    "webcal://scholarium.at/salon.ics"
  );
});

test("an http url stays an ordinary editable row and never fetches", async () => {
  const [alice] = setup([ALICE]);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  renderApp({ ...alice(), fetchCalendarFeed });

  await type("Salon{Enter}{Tab}http://scholarium.at/salon.ics{Escape}");

  await screen.findByRole("textbox", {
    name: "edit http://scholarium.at/salon.ics",
  });
  expect(fetchCalendarFeed).not.toHaveBeenCalled();
});

test("feed fetches are bounded to a few at a time", async () => {
  const workspace = knowstrInit().path;
  const urls = [1, 2, 3, 4, 5, 6].map((n) => `https://scholarium.at/f${n}.ics`);
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      ...urls.map(
        (url, i) => `- [${url}](feed:${url}) <!-- id:f${i} embed="true" -->`
      ),
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  const resolvers = new Map<string, (feed: string) => void>();
  const fetchCalendarFeed = jest.fn(
    (url: string) =>
      new Promise<string>((resolve) => {
        resolvers.set(url, resolve);
      })
  );
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed,
  });

  await waitFor(() => expect(fetchCalendarFeed).toHaveBeenCalledTimes(4));
  const first = resolvers.values().next();
  if (first.done) {
    throw new Error("Missing in-flight fetch");
  }
  first.value(FEED);
  await waitFor(() => expect(fetchCalendarFeed).toHaveBeenCalledTimes(5));
});

test("an uppercase scheme projects like a lowercase one", async () => {
  const [alice] = setup([ALICE]);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  renderApp({ ...alice(), fetchCalendarFeed });

  await type("Salon{Enter}{Tab}HTTPS://scholarium.at/salon.ics{Escape}");

  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");
  expect(fetchCalendarFeed).toHaveBeenCalledWith(
    "https://scholarium.at/salon.ics"
  );
});

test("a feed inside an embedded source still projects", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Agenda{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(0, "Salon");
  await openNodeInFullscreen(0, "Salon");
  await navigateToNodeViaSearch(1, "Agenda");
  await openNodeInFullscreen(1, "Agenda");

  fireEvent.dragStart(getPane(0).getByRole("treeitem", { name: "Salon" }));
  fireEvent.drop(getPane(1).getByRole("treeitem", { name: "Agenda" }));

  await getPane(1).findByLabelText("expand Salon");
  await userEvent.click(getPane(1).getByLabelText("expand Salon"));
  await userEvent.click(
    getPane(1).getByLabelText("expand https://scholarium.at/salon.ics")
  );

  await expectTree(`
Salon
  https://scholarium.at/salon.ics
  [I] Agenda ↩
Agenda
  Salon
    https://scholarium.at/salon.ics
      01.01.2020 Founding seminar
      14.07.2030 Sommerfest
      ${dunbarText()}
  `);
});

test("the same feed in two places shows once; the second placement is a link", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Studium{Enter}{Tab}https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  await expectTree(`
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  Studium
    https://scholarium.at/salon.ics
  `);
});

test("a demoted feed placement opens its calendar whole with its own diff", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      '- [Termine](feed:https://scholarium.at/salon.ics) <!-- id:f1 embed="true" -->',
      "- Studium <!-- id:st -->",
      '  - [Termine](feed:https://scholarium.at/salon.ics) <!-- id:f2 embed="true" -->',
      "    - Meine Notiz <!-- id:n1 -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });
  const [docRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(docRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
  await screen.findByText("14.07.2030 Sommerfest");

  await userEvent.click(
    await screen.findByRole("link", { name: "Navigate to Termine" })
  );

  await expectTree(`
https://scholarium.at/salon.ics
  01.01.2020 Founding seminar
  14.07.2030 Sommerfest
  ${dunbarText()}
  Meine Notiz
  `);
});

test("a demoted event placement opens its event whole with its own diff", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      '- [Termine](feed:https://scholarium.at/salon.ics) <!-- id:f1 embed="true" -->',
      '- [My standup](#ical:sommerfest@scholarium.at) <!-- id:l1 embed="true" -->',
      "  - Meine Notiz <!-- id:n1 -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });
  const [docRoot] = await screen.findAllByRole("treeitem");
  await userEvent.click(docRoot);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
  await screen.findByText("14.07.2030 Sommerfest");

  await userEvent.click(
    await screen.findByRole("link", { name: "Navigate to My standup" })
  );

  await expectTree(`
14.07.2030 Sommerfest
  Meine Notiz
  `);
});

test("entries stay read-only but dragging one writes a move statement", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");

  expect(
    screen.queryByRole("textbox", { name: `edit ${dunbarText()}` })
  ).toBeNull();

  fireEvent.dragStart(screen.getByRole("treeitem", { name: dunbarText() }));
  fireEvent.drop(screen.getByRole("treeitem", { name: "Notes" }));

  await expectTree(`
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
  Notes
  ${dunbarText()}
  `);

  expect(
    screen.queryByRole("textbox", { name: `edit ${dunbarText()}` })
  ).toBeNull();
});

test("a note dropped among entries keeps its slot", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Notes" }));
  fireEvent.drop(
    screen.getByRole("treeitem", { name: "14.07.2030 Sommerfest" })
  );

  const expected = `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    Notes
    ${dunbarText()}
  `;
  await expectTree(expected);

  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(expected);
});

test("dragging an entry within the feed resorts it", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: dunbarText() }));
  fireEvent.drop(
    screen.getByRole("treeitem", { name: "01.01.2020 Founding seminar" })
  );

  const expected = `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    ${dunbarText()}
    14.07.2030 Sommerfest
  `;
  await expectTree(expected);

  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(expected);
});

test("Tab indents a note under an entry", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: "Notes" }));
  fireEvent.drop(
    screen.getByRole("treeitem", { name: "14.07.2030 Sommerfest" })
  );
  await screen.findByText("Notes");

  await clickRow("Notes");
  await userEvent.keyboard("{Tab}");

  const expected = `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
      Notes
    ${dunbarText()}
  `;
  await expectTree(expected);

  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(expected);
});

test("cross-pane drag of an entry lays down a link row, never a copy", async () => {
  const [alice] = setup([ALICE]);
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "Notes");
  await openNodeInFullscreen(1, "Notes");

  fireEvent.dragStart(screen.getByRole("treeitem", { name: dunbarText() }));
  fireEvent.drop(getPane(1).getByRole("treeitem", { name: "Notes" }));

  const expected = `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  Notes
Notes
  ${dunbarText()}
  `;
  await expectTree(expected);

  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(expected);
});

test("feed loading follows embeds in loaded documents, not drawn rows", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      "- Deep <!-- id:deep -->",
      "  - [https://example.org/hidden.ics](feed:https://example.org/hidden.ics)" +
        ' <!-- id:f1 embed="true" -->',
      "- [plain](feed:https://example.org/plain.ics) <!-- id:p1 -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed,
  });

  await screen.findByText("plain");
  await waitFor(() =>
    expect(fetchCalendarFeed).toHaveBeenCalledWith(
      "https://example.org/hidden.ics"
    )
  );
  expect(fetchCalendarFeed).not.toHaveBeenCalledWith(
    "https://example.org/plain.ics"
  );
});

test("a fresh session starts with a fresh feed store", async () => {
  const fetchCalendarFeed = jest
    .fn<Promise<string>, [string]>(() => Promise.reject(new Error("offline")))
    .mockImplementationOnce(() => Promise.resolve(FEED));
  renderApp({ user: undefined, fetchCalendarFeed });

  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "leader monkey parrot ring guide accident before fence cannon height naive bean{enter}"
  );
  await screen.findByLabelText("new node editor", undefined, { timeout: 5000 });
  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");
  expect(fetchCalendarFeed).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByLabelText("open menu"));
  fireEvent.click(await screen.findByLabelText("logout"));
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp{enter}"
  );
  await waitFor(() => expect(fetchCalendarFeed).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("14.07.2030 Sommerfest")).toBeNull();
});

test("feed snapshots do not cross filesystem workspace boundaries", async () => {
  const feedDocument = [
    "# Salon <!-- id:salon -->",
    "",
    "- [https://scholarium.at/salon.ics](feed:https://scholarium.at/salon.ics)" +
      ' <!-- id:f1 embed="true" -->',
    "",
  ].join("\n");
  const first = knowstrInit().path;
  write(first, "salon.md", feedDocument);
  await knowstrSave(first);
  await renderAppTree({
    path: first,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");

  cleanup();
  const second = knowstrInit().path;
  write(second, "salon.md", feedDocument);
  await knowstrSave(second);
  const offline = jest.fn<Promise<string>, [string]>(() =>
    Promise.reject(new Error("offline"))
  );
  await renderAppTree({
    path: second,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed: offline,
  });
  await waitFor(() =>
    expect(offline).toHaveBeenCalledWith("https://scholarium.at/salon.ics")
  );
  expect(
    screen.queryByLabelText("expand https://scholarium.at/salon.ics")
  ).toBeNull();
  expect(screen.queryByText("14.07.2030 Sommerfest")).toBeNull();
});

test("a typed feed url persists a feed link with the embed attr", async () => {
  const workspace = knowstrInit().path;
  write(workspace, "salon.md", "# Salon <!-- id:salon -->\n");
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  const rootEditor = await screen.findByRole("textbox", {
    name: "edit Salon",
  });
  await userEvent.click(rootEditor);
  placeCursorAtEnd(rootEditor);
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "https://scholarium.at/salon.ics"
  );
  await userEvent.keyboard("{Escape}");

  await expectMarkdown(
    workspace,
    "salon.md",
    "# Salon <!-- id:... -->\n\n- [https://scholarium.at/salon.ics](feed:https://scholarium.at/salon.ics)" +
      ' <!-- id:... embed="true" -->\n'
  );
});

test("a bare feed url as a document root persists the feed link", async () => {
  const { path } = await renderAppTree({
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });
  if (!path) {
    throw new Error("expected renderAppTree to return a workspace path");
  }
  await findNewNodeEditor();

  await type("https://scholarium.at/salon.ics{Escape}");

  await expectMarkdown(
    path,
    "httpsscholariumatsalonics.md",
    "- [https://scholarium.at/salon.ics](feed:https://scholarium.at/salon.ics)" +
      ' <!-- id:... embed="true" -->\n'
  );
});

test("a loaded event surface is read-only", async () => {
  const [alice] = setup([ALICE]);
  const readText = jest.fn(() =>
    Promise.resolve(`[${dunbarText()}](#ical:dunbar@scholarium.at)`)
  );
  // eslint-disable-next-line functional/immutable-data
  Object.defineProperty(navigator, "clipboard", {
    value: { readText },
    writable: true,
    configurable: true,
  });
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await userEvent.click(screen.getByRole("treeitem", { name: "Salon" }));
  await userEvent.keyboard("{Meta>}v{/Meta}");
  await userEvent.click(
    await screen.findByRole("link", { name: dunbarText() })
  );

  await expectTree(`
${dunbarText()}
  [I] Salon ↩
  `);
  expect(
    screen.queryByRole("textbox", { name: `edit ${dunbarText()}` })
  ).toBeNull();
  expect(screen.queryByLabelText("new node editor")).toBeNull();
  expect(screen.queryByLabelText(/^set .* to relevant$/u)).toBeNull();
});

test("judging a row mid-edit still mints the feed link", async () => {
  const [alice] = setup([ALICE]);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  renderApp({ ...alice(), fetchCalendarFeed });

  await type("Salon{Enter}{Tab}Notes{Escape}");
  const editor = await screen.findByLabelText("edit Notes");
  await userEvent.click(editor);
  const editBox = await screen.findByRole("textbox", { name: "edit Notes" });
  await userEvent.clear(editBox);
  await userEvent.type(editBox, "https://scholarium.at/salon.ics");
  fireEvent.click(screen.getByLabelText(/^set .* to relevant$/u));

  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");
  expect(fetchCalendarFeed).toHaveBeenCalledWith(
    "https://scholarium.at/salon.ics"
  );
});

test("a multiline-pasted bare feed url projects entries immediately", async () => {
  const [alice] = setup([ALICE]);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  renderApp({ ...alice(), fetchCalendarFeed });
  // eslint-disable-next-line functional/immutable-data
  document.execCommand = jest.fn(() => true);

  await type("Salon{Enter}{Tab}Notes{Escape}");
  const editor = await screen.findByLabelText("edit Notes");
  await userEvent.click(editor);
  const editBox = await screen.findByRole("textbox", { name: "edit Notes" });
  firePaste(editBox, "Notes\nhttps://scholarium.at/salon.ics");

  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");
  expect(fetchCalendarFeed).toHaveBeenCalledWith(
    "https://scholarium.at/salon.ics"
  );
});

test("indenting a link labeled like a feed url keeps its target", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      "- Notes <!-- id:n1 -->",
      "- [https://x.org/f.ics](https://mirror.example/page) <!-- id:l1 -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed,
  });

  const editor = await screen.findByRole("textbox", {
    name: "edit https://x.org/f.ics",
  });
  await userEvent.click(editor);
  placeCursorAtEnd(editor);
  await userEvent.keyboard("{Tab}");

  await expectMarkdown(
    workspace,
    "salon.md",
    "# Salon <!-- id:... -->\n\n- Notes <!-- id:... -->\n" +
      "  - [https://x.org/f.ics](https://mirror.example/page) <!-- id:... -->\n"
  );
  expect(fetchCalendarFeed).not.toHaveBeenCalled();
});

test("a pasted link labeled like a feed url keeps its target", async () => {
  const [alice] = setup([ALICE]);
  const fetchCalendarFeed = jest.fn(() => Promise.resolve(FEED));
  renderApp({ ...alice(), fetchCalendarFeed });
  // eslint-disable-next-line functional/immutable-data
  document.execCommand = jest.fn(() => true);

  await type("Salon{Enter}{Tab}Notes{Escape}");
  const editor = await screen.findByLabelText("edit Notes");
  await userEvent.click(editor);
  const editBox = await screen.findByRole("textbox", { name: "edit Notes" });
  firePaste(
    editBox,
    "Notes\n[https://x.org/f.ics](https://mirror.example/page)"
  );

  const link = await screen.findByRole("link", {
    name: "https://x.org/f.ics (opens externally)",
  });
  expect(link.getAttribute("data-href")).toBe("https://mirror.example/page");
  expect(fetchCalendarFeed).not.toHaveBeenCalled();
});

test("an explicit event embed shows the live event and keeps no editor", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      '- [Frozen label](#ical:dunbar@scholarium.at) <!-- id:l1 embed="true" -->',
      "- [https://scholarium.at/salon.ics](feed:https://scholarium.at/salon.ics)" +
        ' <!-- id:f1 embed="true" -->',
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await screen.findByText(dunbarText());
  expect(screen.queryByText("Frozen label")).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: "edit Frozen label" })
  ).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: `edit ${dunbarText()}` })
  ).toBeNull();
});

test("a direct feed embed carries the calendar icon", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      "- [https://scholarium.at/salon.ics](feed:https://scholarium.at/salon.ics)" +
        ' <!-- id:f1 embed="true" -->',
      "",
    ].join("\n")
  );
  write(
    workspace,
    "agenda.md",
    [
      "# Agenda <!-- id:agenda -->",
      "",
      '- [Salon feed](#f1) <!-- id:a1 embed="true" -->',
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "agenda.md"),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await screen.findByText("https://scholarium.at/salon.ics");
  expect(screen.getByTitle("Calendar").textContent).toBe("🗓︎");
});

test("two feeds load side by side and resolve their own events", async () => {
  const secondFeed = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:retreat@example.org",
    "DTSTART;VALUE=DATE:20301224",
    "SUMMARY:Winter retreat",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const workspace = knowstrInit().path;
  write(
    workspace,
    "salon.md",
    [
      "# Salon <!-- id:salon -->",
      "",
      '- [Retreat](#ical:retreat@example.org) <!-- id:l1 embed="true" -->',
      "- [https://scholarium.at/salon.ics](feed:https://scholarium.at/salon.ics)" +
        ' <!-- id:f1 embed="true" -->',
      "- [https://example.org/retreats.ics](feed:https://example.org/retreats.ics)" +
        ' <!-- id:f2 embed="true" -->',
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);
  const fetchCalendarFeed = jest.fn((url: string) =>
    Promise.resolve(
      url === "https://example.org/retreats.ics" ? secondFeed : FEED
    )
  );
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "salon.md"),
    fetchCalendarFeed,
  });

  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await screen.findByText("14.07.2030 Sommerfest");
  await screen.findByText("24.12.2030 Winter retreat");
  expect(fetchCalendarFeed).toHaveBeenCalledWith(
    "https://scholarium.at/salon.ics"
  );
  expect(fetchCalendarFeed).toHaveBeenCalledWith(
    "https://example.org/retreats.ics"
  );
});

test("following a dangling entry link opens the entry surface", async () => {
  const [alice] = setup([ALICE]);
  const readText = jest.fn(() =>
    Promise.resolve(`[${dunbarText()}](#ical:dunbar@scholarium.at)`)
  );
  // eslint-disable-next-line functional/immutable-data
  Object.defineProperty(navigator, "clipboard", {
    value: { readText },
    writable: true,
    configurable: true,
  });
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await userEvent.click(screen.getByRole("treeitem", { name: "Salon" }));
  await userEvent.keyboard("{Meta>}v{/Meta}");

  await userEvent.click(
    await screen.findByRole("link", { name: dunbarText() })
  );
  await expectTree(`
${dunbarText()}
  [I] Salon ↩
  `);
  expect(new URLSearchParams(window.location.search).get("label")).toBe(
    dunbarText()
  );
});

import { screen, waitFor } from "@testing-library/react";
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
import { findNewNodeEditor } from "../utils.test";
import { KIND_KNOWLEDGE_DEPOSIT } from "../nostr";

function wikidataResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function wikidataFetch(): jest.Mock<Promise<Response>, [string]> {
  return jest.fn((url: string) => {
    const parsed = new URL(url);
    const action = parsed.searchParams.get("action");
    if (action === "wbsearchentities") {
      if (parsed.searchParams.get("language") !== "en") {
        return Promise.resolve(
          wikidataResponse({
            error: {
              code: "badvalue",
              info: `Unrecognized value for parameter language: ${parsed.searchParams.get(
                "language"
              )}`,
            },
          })
        );
      }
      const search = parsed.searchParams.get("search")?.toLowerCase() ?? "";
      if (search.includes("vien")) {
        return Promise.resolve(
          wikidataResponse({
            search: [
              {
                id: "Q1741",
                label: "Vienna",
                description: "capital of Austria",
              },
            ],
          })
        );
      }
      if (search.includes("sagrada")) {
        return Promise.resolve(
          wikidataResponse({
            search: [
              {
                id: "Q48435",
                label: "Sagrada Família",
                description: "minor basilica in Barcelona",
              },
            ],
          })
        );
      }
      if (search.includes("casa")) {
        return Promise.resolve(
          wikidataResponse({
            search: [
              {
                id: "Q746333",
                label: "Casa Vicens",
                description: "family residence in Barcelona",
              },
            ],
          })
        );
      }
      if (search.includes("1868")) {
        return Promise.resolve(
          wikidataResponse({
            search: [
              {
                id: "Q7717",
                label: "1868",
                description: "year",
              },
              {
                id: "Q11185459",
                label: "1868",
                description: "natural number",
              },
            ],
          })
        );
      }
      return Promise.resolve(
        wikidataResponse({
          search: [
            {
              id: "Q1492",
              label: "Barcelona",
              description: "city in Catalonia, Spain",
            },
            {
              id: "Q244",
              label: "Barbados",
              description: "island country in the Caribbean",
            },
            {
              id: "Q999",
              label: "Baroque concept",
              description: "broad style concept",
            },
          ],
        })
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  });
}

async function chooseBarcelona(): Promise<void> {
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Insert entity Barcelona wd:Q1492",
    })
  );
}

function placeCursorAtEnd(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function openNotesChildEditor(): Promise<HTMLElement> {
  const rootEditor = await screen.findByRole("textbox", { name: "edit Notes" });
  await userEvent.click(rootEditor);
  placeCursorAtEnd(rootEditor);
  await userEvent.keyboard("{Enter}");
  return findNewNodeEditor();
}

test("entity picker inserts a Wikidata link in an empty row and publish tags derive from it", async () => {
  const workspace = knowstrInit({ relays: ["wss://relay.test.example"] }).path;
  write(workspace, "notes.md", "# Notes <!-- id:notes-root -->\n");
  await knowstrSave(workspace);
  const fetchEntityMetadata = wikidataFetch();
  const { relayPool } = await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "notes.md"),
    fetchEntityMetadata,
  });

  await userEvent.type(await openNotesChildEditor(), "@Bar");
  await chooseBarcelona();
  await userEvent.keyboard("{Escape}");

  await expectMarkdown(
    workspace,
    "notes.md",
    "# Notes <!-- id:... -->\n\n- [Barcelona](#wd:Q1492) <!-- id:... -->\n"
  );

  await userEvent.click(await screen.findByLabelText("audience options"));
  await userEvent.click(await screen.findByLabelText("publish document"));
  await waitFor(() => {
    const deposit = relayPool
      .getEvents()
      .find(
        (event) =>
          event.kind === KIND_KNOWLEDGE_DEPOSIT &&
          event.content.includes("[Barcelona](#wd:Q1492)")
      );
    expect(deposit?.tags.filter(([name]) => name === "S")).toEqual([
      ["S", "notes-root"],
      ["S", "wd:Q1492"],
    ]);
  });
});

test("entity picker inserts a Wikidata link inside existing row text", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "notes.md",
    "# Notes <!-- id:notes-root -->\n- Placeholder <!-- id:line -->\n"
  );
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "notes.md"),
    fetchEntityMetadata: wikidataFetch(),
  });

  const editor = await screen.findByRole("textbox", {
    name: "edit Placeholder",
  });
  await userEvent.clear(editor);
  await userEvent.type(editor, "I met @Bar");
  await chooseBarcelona();
  await userEvent.keyboard("in Vienna{Escape}");

  await expectMarkdown(
    workspace,
    "notes.md",
    "# Notes <!-- id:... -->\n\n- I met [Barcelona](#wd:Q1492) in Vienna <!-- id:... -->\n"
  );
});

test("entity picker keeps local entities before Wikidata results", async () => {
  const workspace = knowstrInit().path;
  write(workspace, "barcelona.md", "# Barcelona <!-- id:wd:Q1492 -->\n");
  write(workspace, "notes.md", "# Notes <!-- id:notes-root -->\n");
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "notes.md"),
    fetchEntityMetadata: wikidataFetch(),
  });

  await userEvent.type(await openNotesChildEditor(), "@Bar");
  await screen.findByRole("option", {
    name: "Insert entity Barbados wd:Q244",
  });
  await screen.findByRole("option", {
    name: "Insert entity Baroque concept wd:Q999",
  });

  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    "Barcelonawd:Q1492locallocal entity",
    "Barbadoswd:Q244wikidataisland country in the Caribbean",
    "Baroque conceptwd:Q999wikidatabroad style concept",
  ]);
});

test("entity picker stays open across multi-word local queries", async () => {
  const workspace = knowstrInit().path;
  write(workspace, "mises.md", "# Ludwig von Mises <!-- id:wd:Q7243 -->\n");
  write(workspace, "notes.md", "# Notes <!-- id:notes-root -->\n");
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "notes.md"),
    fetchEntityMetadata: wikidataFetch(),
  });

  const editor = await openNotesChildEditor();
  await userEvent.type(editor, "@LUdwig ");
  await screen.findByRole("option", {
    name: "Insert entity Ludwig von Mises wd:Q7243",
  });
  await userEvent.type(editor, "von Mises");
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Insert entity Ludwig von Mises wd:Q7243",
    })
  );
  await userEvent.keyboard("{Escape}");

  await expectMarkdown(
    workspace,
    "notes.md",
    "# Notes <!-- id:... -->\n\n- [Ludwig von Mises](#wd:Q7243) <!-- id:... -->\n"
  );
});

test("entity picker preserves spaces between repeated entity picks", async () => {
  const workspace = knowstrInit().path;
  write(workspace, "hayek.md", "# Hayek <!-- id:wd:Q1325 -->\n");
  write(workspace, "vienna.md", "# Vienna <!-- id:wd:Q1741 -->\n");
  write(workspace, "mises.md", "# Mises <!-- id:wd:Q7243 -->\n");
  write(workspace, "notes.md", "# Notes <!-- id:notes-root -->\n");
  await knowstrSave(workspace);
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "notes.md"),
    fetchEntityMetadata: wikidataFetch(),
  });

  const editor = await openNotesChildEditor();
  await userEvent.type(editor, "@Hay");
  await userEvent.click(
    await screen.findByRole("option", { name: "Insert entity Hayek wd:Q1325" })
  );
  await userEvent.type(editor, "in @Vien");
  await userEvent.click(
    await screen.findByRole("option", { name: "Insert entity Vienna wd:Q1741" })
  );
  await userEvent.type(editor, "with @Mis");
  await userEvent.click(
    await screen.findByRole("option", { name: "Insert entity Mises wd:Q7243" })
  );
  await userEvent.keyboard("{Escape}");

  await expectMarkdown(
    workspace,
    "notes.md",
    "# Notes <!-- id:... -->\n\n- [Hayek](#wd:Q1325) in [Vienna](#wd:Q1741) with [Mises](#wd:Q7243) <!-- id:... -->\n"
  );
});

test("entity picker accepts unfiltered Wikidata search results", async () => {
  const workspace = knowstrInit().path;
  write(workspace, "notes.md", "# Notes <!-- id:notes-root -->\n");
  await knowstrSave(workspace);
  const fetchEntityMetadata = wikidataFetch();
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "notes.md"),
    fetchEntityMetadata,
  });

  const editor = await openNotesChildEditor();
  await userEvent.type(editor, "@Vien");
  await userEvent.click(
    await screen.findByRole("option", { name: "Insert entity Vienna wd:Q1741" })
  );
  await userEvent.type(editor, "and @Sagrada");
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Insert entity Sagrada Família wd:Q48435",
    })
  );
  await userEvent.type(editor, "near @Casa");
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Insert entity Casa Vicens wd:Q746333",
    })
  );
  await userEvent.type(editor, "in @1868");
  const year = await screen.findByRole("option", {
    name: "Insert entity 1868 wd:Q7717",
  });
  await screen.findByRole("option", {
    name: "Insert entity 1868 wd:Q11185459",
  });
  expect(
    fetchEntityMetadata.mock.calls.some(([url]) =>
      url.includes("action=wbgetentities")
    )
  ).toBe(false);
  await userEvent.click(year);
  await userEvent.keyboard("{Escape}");

  await expectMarkdown(
    workspace,
    "notes.md",
    "# Notes <!-- id:... -->\n\n- [Vienna](#wd:Q1741) and [Sagrada Família](#wd:Q48435) near [Casa Vicens](#wd:Q746333) in [1868](#wd:Q7717) <!-- id:... -->\n"
  );
});

test("entity picker debounces Wikidata and passive typing stays local", async () => {
  const workspace = knowstrInit().path;
  write(workspace, "notes.md", "# Notes <!-- id:notes-root -->\n");
  await knowstrSave(workspace);
  const fetchEntityMetadata = wikidataFetch();
  await renderAppTree({
    path: workspace,
    initialRoute: buildDocumentRouteUrl(LOCAL, "notes.md"),
    fetchEntityMetadata,
  });

  const editor = await openNotesChildEditor();
  await userEvent.type(editor, "Barcelona");
  await new Promise((resolve) => {
    window.setTimeout(resolve, 250);
  });
  expect(fetchEntityMetadata).not.toHaveBeenCalled();

  await userEvent.clear(editor);
  await userEvent.type(editor, "@Bar");
  expect(fetchEntityMetadata).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(
      fetchEntityMetadata.mock.calls.some(([url]) =>
        url.includes("action=wbsearchentities")
      )
    ).toBe(true);
  });
});

test("editable rows with repeated identical entity links do not emit duplicate key warnings", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "entities.md",
    [
      "# Tagged Entities <!-- id:tagged-entities -->",
      "- [Rußland](#wd:Q159) and [Rußland](#wd:Q159) <!-- id:duplicate-russia -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);

  const renderErrors = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    await renderAppTree({
      path: workspace,
      initialRoute: buildDocumentRouteUrl(LOCAL, "entities.md"),
    });
    await screen.findByLabelText("edit Rußland and Rußland");
    await waitFor(() => {
      expect(
        renderErrors.mock.calls.some((call) =>
          call.some(
            (part) =>
              typeof part === "string" &&
              part.includes("Encountered two children with the same key")
          )
        )
      ).toBe(false);
    });
  } finally {
    renderErrors.mockRestore();
  }
});

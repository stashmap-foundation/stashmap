import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// eslint-disable-next-line import/no-unresolved
import { BasicRelayInformation } from "nostr-tools/lib/types/nip11";
import { Map } from "immutable";
import { SearchModal } from "./SearchModal";
import { newNode } from "../connections";
import {
  ALICE,
  BOB,
  CAROL,
  createExampleProject,
  matchSplitText,
  planUpsertProjectNode,
  renderApp,
  renderWithTestData,
  setup,
} from "../utils.test";
import {
  createPlan,
  planBulkUpsertNodes,
  planUpsertMemberlist,
  planUpsertNode,
} from "../planner";
import { execute } from "../executor";

test("Search works like spotlight", async () => {
  const [alice] = setup([ALICE]);
  const { publicKey } = alice().user;

  const note = newNode("My very first search note made", publicKey);
  const secondNote = newNode("My second search note ever made", publicKey);
  const thirdNote = newNode("My third search note made", publicKey);
  const topic = newNode("My very first topic", publicKey);

  await execute({
    ...alice(),
    plan: planUpsertNode(
      planUpsertNode(
        planUpsertNode(planUpsertNode(createPlan(alice()), note), secondNote),
        thirdNote
      ),
      topic
    ),
  });

  renderApp(alice());

  // Pressing enter adds first search result -which is a topic) to Column
  const searchButton = await screen.findByLabelText(
    "search and attach to Default Workspace"
  );
  fireEvent.click(searchButton);
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "My very first");
  const searchResults = await screen.findAllByText("My very first", {
    exact: false,
  });
  expect(searchResults).toHaveLength(2);
  const firstResult = screen.getByText(matchSplitText("My very first topic"));
  await userEvent.type(firstResult, "{enter}");
  expect(screen.queryByLabelText("search input")).toBeNull();
  await screen.findAllByText("My very first topic");

  // Pressing down and enter adds second search result to Note
  const searchButtons = await screen.findAllByLabelText(
    "search and attach to My very first topic"
  );
  fireEvent.click(searchButtons[0]);
  const secondSearchInput = await screen.findByLabelText("search input");
  await userEvent.type(secondSearchInput, "search note");
  const secondSearchResults = await screen.findAllByText("search note", {
    exact: false,
  });
  expect(secondSearchResults).toHaveLength(3);
  const secondResult = screen.getByText(
    matchSplitText("My second search note ever made")
  );
  await userEvent.type(secondSearchInput, "{arrowdown}");
  await userEvent.type(secondResult, "{enter}");
  expect(screen.queryByLabelText("search input")).toBeNull();
  await screen.findByText("My second search note ever made");

  const allSearchButtons = await screen.findByLabelText(
    "search and attach to Default Workspace"
  );
  fireEvent.click(allSearchButtons);
  const searchInputField = await screen.findByLabelText("search input");
  await userEvent.type(searchInputField, "first search");
  await screen.findByText(matchSplitText("My very first search note made"));
  await userEvent.type(searchInputField, "{escape}");
  expect(screen.queryByText("My first search note made")).toBeNull();
  await userEvent.type(searchInputField, "{escape}");
  expect(screen.queryByPlaceholderText("Search")).toBeNull();
});

test("Search starts with press on slash key", async () => {
  const [alice] = setup([ALICE]);
  await execute({
    ...alice(),
    plan: planUpsertNode(
      createPlan(alice()),
      newNode("My source", alice().user.publicKey)
    ),
  });
  renderApp({ ...alice(), includeFocusContext: true });
  await userEvent.type(await screen.findByText("Default Workspace"), "/");
  screen.getByPlaceholderText("Search");
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "My s");
  const text = await screen.findByText(matchSplitText("My source"));
  await userEvent.click(text);
  expect(screen.queryByPlaceholderText("Search")).toBeNull();
  await screen.findByText("My source");
});

test("Results from relays with nip-50 support will be shown unfiltered", async () => {
  const [alice] = setup([ALICE]);
  await execute({
    ...alice(),
    plan: planUpsertNode(
      createPlan(alice()),
      newNode("Bitcoin", alice().user.publicKey)
    ),
  });
  renderWithTestData(
    <SearchModal onAddExistingNode={jest.fn()} onHide={jest.fn()} />,
    {
      ...alice(),
      nip11: {
        searchDebounce: 0,
        fetchRelayInformation: () => {
          return Promise.resolve({
            supported_nips: [50],
          } as BasicRelayInformation);
        },
      },
    }
  );
  const searchInput = await screen.findByLabelText("search input");
  // The mock relay pool ignores the search parameter completely
  await userEvent.type(searchInput, "Bitcorn");
  await screen.findByText("Bitcoin");
});

test("Client side filtering when relay does not support nip-50", async () => {
  const [alice] = setup([ALICE]);
  await execute({
    ...alice(),
    plan: planBulkUpsertNodes(createPlan(alice()), [
      newNode("Bitcoin", alice().user.publicKey),
      newNode("Bircoin", alice().user.publicKey),
    ]),
  });
  renderWithTestData(
    <SearchModal onAddExistingNode={jest.fn()} onHide={jest.fn()} />,
    alice()
  );
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Bi");
  await screen.findByText("Bitcoin");
  await screen.findByText("Bircoin");
  await userEvent.type(searchInput, "tcoin");
  await screen.findByText("Bitcoin");
  await waitFor(() => {
    expect(screen.queryByText("Bircoin")).toBeNull();
  });
});

test("Search for Projects", async () => {
  const [alice] = setup([ALICE]);
  await execute({
    ...alice(),
    plan: planUpsertProjectNode(
      createPlan(alice()),
      createExampleProject(alice().user.publicKey)
    ),
  });
  renderWithTestData(
    <SearchModal onAddExistingNode={jest.fn()} onHide={jest.fn()} />,
    alice()
  );
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Winch");
  await screen.findByText(matchSplitText("Winchester Mystery House"));
});

test("Find Project Members Notes", async () => {
  const [alice, bob, carol] = setup([ALICE, BOB, CAROL]);
  const project = createExampleProject(CAROL.publicKey);
  await execute({
    ...carol(),
    plan: planUpsertProjectNode(createPlan(carol()), project),
  });
  await execute({
    ...carol(),
    plan: planUpsertMemberlist(
      createPlan(carol()),
      Map<PublicKey, Member>({
        [ALICE.publicKey]: {
          ...ALICE,
          votes: 10000,
        },
        [BOB.publicKey]: {
          ...BOB,
          votes: 10000,
        },
      })
    ),
  });
  await execute({
    ...bob(),
    plan: planBulkUpsertNodes(createPlan(bob()), [
      newNode("Bitcoin", bob().user.publicKey),
    ]),
  });
  // Alice finds Bob's notes because he is a project member as well
  renderWithTestData(
    <SearchModal onAddExistingNode={jest.fn()} onHide={jest.fn()} />,
    {
      ...alice(),
      initialRoute: `/?project=${project.id}`,
    }
  );
  const searchInput = await screen.findByLabelText("search input");
  await userEvent.type(searchInput, "Bit");
  await screen.findByText(matchSplitText("Bitcoin"));
});

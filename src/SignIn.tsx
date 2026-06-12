import React, { useEffect, useRef, useState } from "react";
import { Form, Modal } from "react-bootstrap";
import { useLocation, useNavigate } from "react-router-dom";
import { ErrorMessage } from "./commons/ErrorMessage";
import { Button } from "./commons/Ui";
import { createSubmitHandler } from "./commons/modalFormSubmitHandler";
import {
  isUserLoggedIn,
  useLogin,
  useLoginWithExtension,
} from "./NostrAuthContext";
import { useData } from "./DataContext";
import { convertInputToPrivateKey } from "./nostrKey";
import { supportsExtensionLogin } from "./runtimeEnvironment";

function SignInWithSeed({
  setPrivateKey,
}: {
  setPrivateKey: (privateKey: string) => void;
}): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const componentIsMounted = useRef(true);
  useEffect(() => {
    return () => {
      // eslint-disable-next-line functional/immutable-data
      componentIsMounted.current = false;
    };
  }, []);

  const submit = (form: HTMLFormElement): Promise<void> => {
    const seedPhrase = (
      form.elements.namedItem("inputSeed") as HTMLInputElement
    ).value;
    const privateKey = convertInputToPrivateKey(seedPhrase);
    if (!privateKey) {
      throw new Error("Input is not a valid nsec, private key or mnemonic");
    }
    setPrivateKey(privateKey);
    return Promise.resolve();
  };
  const onSubmit = createSubmitHandler({
    setLoading: (l) => {
      if (componentIsMounted.current) {
        setLoading(l);
      }
    },
    setError,
    submit,
  });

  return (
    <Form onSubmit={onSubmit}>
      <div className="d-flex align-children-center gap-2">
        <Form.Group controlId="inputSeed" className="flex-grow-1">
          <Form.Control
            type="password"
            placeholder="nsec, private key or mnemonic (12 words)"
            required
          />
        </Form.Group>
        {loading ? (
          <div aria-label="loading" className="spinner-border" />
        ) : (
          <Button type="submit" className="btn btn-outline-dark">
            Continue
          </Button>
        )}
      </div>
      {error && (
        <div className="mt-2">
          <ErrorMessage error={error} setError={setError} />
        </div>
      )}
    </Form>
  );
}

function CreateAccountButton({
  referrer,
  className,
}: {
  referrer: string;
  className?: string;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <Button
      className={className || "btn btn-outline-dark"}
      onClick={() => {
        navigate("/signup", {
          state: { referrer },
        });
      }}
    >
      Create new Account
    </Button>
  );
}

function SignInWithExtension({
  setPublicKey,
  referrer,
}: {
  setPublicKey: (publicKey: PublicKey) => void;
  referrer: string;
}): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const componentIsMounted = useRef(true);
  useEffect(() => {
    return () => {
      // eslint-disable-next-line functional/immutable-data
      componentIsMounted.current = false;
    };
  }, []);

  const getPublicKeyFromExtension = async (): Promise<
    PublicKey | undefined
  > => {
    try {
      return window.nostr.getPublicKey();
      // eslint-disable-next-line no-empty
    } catch {
      return undefined;
    }
  };

  const submit = async (): Promise<void> => {
    const publicKey = await getPublicKeyFromExtension();
    if (!publicKey) {
      throw new Error("No public key found in extension");
    }
    setPublicKey(publicKey);
  };
  const onSubmit = createSubmitHandler({
    setLoading: (l) => {
      if (componentIsMounted.current) {
        setLoading(l);
      }
    },
    setError,
    submit,
  });

  return (
    <Form onSubmit={onSubmit}>
      <div className="d-flex align-children-center gap-2 mt-3">
        {loading ? (
          <div aria-label="loading" className="spinner-border" />
        ) : (
          <Button type="submit" className="btn btn-outline-dark">
            Continue with Extension
          </Button>
        )}
        <CreateAccountButton
          referrer={referrer}
          className="btn btn-outline-dark"
        />
      </div>
      {error && (
        <div className="mt-2">
          <ErrorMessage error={error} setError={setError} />
        </div>
      )}
    </Form>
  );
}

export function SignInModal(): JSX.Element {
  const login = useLogin();
  const loginWithExtension = useLoginWithExtension();
  const allowExtensionLogin = supportsExtensionLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const referrer = (location.state as LocationState | undefined)?.referrer;
  const signInReferrer = `${location.pathname}${location.search}${location.hash}`;
  const onHide = (): void => {
    navigate(referrer || "/");
  };

  const signIn = ({
    withExtension,
    key,
  }: {
    withExtension: boolean;
    key: string | PublicKey;
  }): void => {
    if (!login || !loginWithExtension) {
      return;
    }
    if (withExtension) {
      loginWithExtension(key as PublicKey);
    } else {
      login(key as string);
    }
    setTimeout(() => navigate(referrer || "/"), 0);
  };
  return (
    <Modal show onHide={onHide} className="command-bar">
      <Modal.Header closeButton>
        <Modal.Title>Login</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <SignInWithSeed
          setPrivateKey={(privateKey) =>
            signIn({ withExtension: false, key: privateKey })
          }
        />
        {allowExtensionLogin ? (
          <SignInWithExtension
            setPublicKey={(publicKey) =>
              signIn({ withExtension: true, key: publicKey })
            }
            referrer={signInReferrer}
          />
        ) : (
          <div className="mt-3 d-flex flex-column gap-2 align-items-start">
            <div className="text-muted">
              Desktop app currently supports nsec or private key login.
            </div>
            <CreateAccountButton referrer={signInReferrer} />
          </div>
        )}
      </Modal.Body>
    </Modal>
  );
}

export function SignInMenuBtn(): JSX.Element | null {
  const { user } = useData();
  const navigate = useNavigate();
  const isLoggedIn = isUserLoggedIn(user);
  if (isLoggedIn) {
    return null;
  }
  return (
    <button
      type="button"
      className="header-action-btn"
      onClick={() => navigate("/signin")}
      aria-label="sign in"
    >
      sign in
    </button>
  );
}

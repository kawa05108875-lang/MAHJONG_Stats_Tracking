"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  getFirebaseAuth,
  getFirebaseDb,
  googleAuthProvider,
  isFirebaseConfigured,
} from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_CHECK_TIMEOUT_MS = 5000;

function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("auth/unauthorized-domain")) {
    return "このURLはFirebase Authenticationの承認済みドメインに登録されていません。Firebase Consoleで現在のドメインをAuthorized domainsに追加してください。";
  }

  if (message.includes("auth/popup-blocked")) {
    return "ログイン画面のポップアップがブロックされました。ページを再読み込みしてもう一度試してください。";
  }

  if (message.includes("permission")) {
    return "ログインは完了しましたが、Firestoreへのユーザー情報保存が権限エラーで失敗しました。Firebase ConsoleでFirestore Rulesを設定してください。";
  }

  return message || "Googleログインに失敗しました。";
}

async function upsertUserProfile(currentUser: User) {
  const userRef = doc(getFirebaseDb(), "users", currentUser.uid);
  const userSnapshot = await getDoc(userRef);

  await setDoc(
    userRef,
    {
      uid: currentUser.uid,
      displayName: currentUser.displayName,
      email: currentUser.email,
      photoURL: currentUser.photoURL,
      updatedAt: serverTimestamp(),
      ...(userSnapshot.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    let authResolved = false;
    const timeoutId = window.setTimeout(() => {
      if (!authResolved) {
        setLoading(false);
        setError("認証状態の確認に時間がかかっています。ログインを試してください。");
      }
    }, AUTH_CHECK_TIMEOUT_MS);

    let unsubscribe: (() => void) | undefined;

    try {
      const auth = getFirebaseAuth();

      void getRedirectResult(auth)
        .then(async (result) => {
          if (result?.user) {
            await upsertUserProfile(result.user);
          }
        })
        .catch((redirectError) => {
          setError(authErrorMessage(redirectError));
        });

      unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        authResolved = true;
        window.clearTimeout(timeoutId);
        setUser(currentUser);
        setLoading(false);

        if (currentUser) {
          try {
            await upsertUserProfile(currentUser);
          } catch {
            setError("Firestoreへのユーザー情報保存に失敗しました。");
          }
        }
      });
    } catch {
      authResolved = true;
      window.clearTimeout(timeoutId);
      window.setTimeout(() => {
        setLoading(false);
        setError("Firebase Authenticationの初期化に失敗しました。");
      }, 0);
    }

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      signInWithGoogle: async () => {
        setError(null);

        if (!isFirebaseConfigured) {
          setError("Firebaseの環境変数が未設定です。.env.localを作成してください。");
          return;
        }

        try {
          const auth = getFirebaseAuth();
          await signInWithRedirect(auth, googleAuthProvider);
        } catch (signInError) {
          setError(authErrorMessage(signInError));
        }
      },
      logout: async () => {
        setError(null);

        if (!isFirebaseConfigured) {
          setUser(null);
          return;
        }

        await signOut(getFirebaseAuth());
      },
    }),
    [error, loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}

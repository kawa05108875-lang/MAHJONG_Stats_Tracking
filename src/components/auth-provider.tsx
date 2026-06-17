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
  onAuthStateChanged,
  signInWithPopup,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
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
          const result = await signInWithPopup(getFirebaseAuth(), googleAuthProvider);
          const currentUser = result.user;
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
        } catch (signInError) {
          const message =
            signInError instanceof Error
              ? signInError.message
              : "Googleログインに失敗しました。";

          setError(
            message.includes("permission")
              ? "ログインは完了しましたが、Firestoreへのユーザー情報保存が権限エラーで失敗しました。Firebase ConsoleでFirestore Rulesを設定してください。"
              : message,
          );
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

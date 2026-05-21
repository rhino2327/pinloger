import { useState, useEffect } from 'react';
import { doc, setDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../config/firebase';

export function useUserProfile() {
  const [profile, setProfile] = useState(null);
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setProfile(snap.data());
      } else {
        const defaultProfile = {
          nickname: user.displayName || user.email?.split('@')[0] || '여행자',
          avatar: '✈️',
          email: user.email,
          provider: user.providerData?.[0]?.providerId || 'email',
          createdAt: new Date().toISOString(),
        };
        setDoc(ref, defaultProfile);
        setProfile(defaultProfile);
      }
    });
    return unsub;
  }, [user?.uid]);

  /**
   * 닉네임 중복 체크
   * @returns {Promise<boolean>} true = 이미 사용 중
   */
  const isNicknameTaken = async (nickname) => {
    if (!nickname?.trim()) return false;
    const q = query(
      collection(db, 'users'),
      where('nickname', '==', nickname.trim())
    );
    const snap = await getDocs(q);
    // 자기 자신의 문서만 있으면 중복 아님
    const others = snap.docs.filter(d => d.id !== user?.uid);
    return others.length > 0;
  };

  const updateProfile = async (updates) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), updates, { merge: true });
  };

  return { profile, updateProfile, isNicknameTaken };
}

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  updatePassword, reauthenticateWithCredential,
  EmailAuthProvider, deleteUser, signOut,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import { useUserProfile } from '../hooks/useUserProfile';

const AVATARS = [
  '✈️','🌍','🗺️','🏔️','🏖️','🌊','🗼','🎌','🏯','⛩️',
  '🌸','🍜','🍣','🥘','🎭','🎪','🚂','🚢','🛺','🦁',
  '🐬','🦋','🌺','🌴','🏕️','⛺','🎿','🤿','🧳','📸',
];

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { profile, updateProfile, isNicknameTaken } = useUserProfile();
  const user = auth.currentUser;
  const isEmailUser = user?.providerData?.[0]?.providerId === 'password';

  const [nickname, setNickname] = useState('');
  const [nickError, setNickError] = useState('');
  const [editingNick, setEditingNick] = useState(false);
  const [avatarModal, setAvatarModal] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  const saveNickname = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    if (trimmed.length < 2) {
      setNickError('닉네임은 2자 이상이어야 해요.');
      return;
    }
    if (trimmed.length > 12) {
      setNickError('닉네임은 12자 이하여야 해요.');
      return;
    }
    try {
      const taken = await isNicknameTaken(trimmed);
      if (taken) {
        setNickError('이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해주세요.');
        return;
      }
      await updateProfile({ nickname: trimmed });
      setEditingNick(false);
      setNickError('');
    } catch (e) {
      setNickError('저장에 실패했어요. 다시 시도해주세요.');
    }
  };

  const selectAvatar = async (emoji) => {
    try {
      await updateProfile({ avatar: emoji });
    } catch (e) {
      Alert.alert('오류', '아바타 저장에 실패했어요. 다시 시도해주세요.');
    } finally {
      setAvatarModal(false);
    }
  };

  const changePassword = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      Alert.alert('알림', '모든 항목을 입력해주세요.'); return;
    }
    if (newPw !== confirmPw) {
      Alert.alert('알림', '새 비밀번호가 일치하지 않아요.'); return;
    }
    if (newPw.length < 6) {
      Alert.alert('알림', '비밀번호는 6자 이상이어야 해요.'); return;
    }
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);
      Alert.alert('완료', '비밀번호가 변경됐어요!');
      setPwModal(false);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e) {
      const msgs = {
        'auth/wrong-password': '현재 비밀번호가 틀렸어요.',
        'auth/invalid-credential': '현재 비밀번호가 틀렸어요.',
        'auth/too-many-requests': '잠시 후 다시 시도해주세요.',
      };
      Alert.alert('오류', msgs[e.code] || '다시 시도해주세요.');
    }
  };

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃 하시겠어요?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => signOut(auth) },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      '계정 삭제',
      '계정을 삭제하면 모든 데이터가 사라져요.\n정말 삭제하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제', style: 'destructive',
          onPress: async () => {
            try {
              await deleteUser(user);
            } catch (e) {
              if (e.code === 'auth/requires-recent-login') {
                Alert.alert('알림', '보안을 위해 다시 로그인 후 시도해주세요.');
                signOut(auth);
              }
            }
          }
        }
      ]
    );
  };

  if (!profile) return (
    <View style={styles.container}>
      <Text style={styles.loadingText}>불러오는 중...</Text>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {/* 프로필 카드 */}
      <View style={styles.profileCard}>
        <TouchableOpacity style={styles.avatarBtn} onPress={() => setAvatarModal(true)}>
          <Text style={styles.avatarText}>{profile.avatar || '✈️'}</Text>
          <View style={styles.editAvatarBadge}><Text style={styles.editAvatarText}>✏️</Text></View>
        </TouchableOpacity>

        {editingNick ? (
          <View style={{ alignItems: 'center' }}>
            <View style={styles.nickEditRow}>
              <TextInput
                style={styles.nickInput}
                value={nickname}
                onChangeText={t => { setNickname(t); setNickError(''); }}
                placeholder="닉네임 (2~12자)"
                placeholderTextColor="#aaa"
                autoFocus
                maxLength={12}
              />
              <TouchableOpacity style={styles.nickSaveBtn} onPress={saveNickname}>
                <Text style={styles.nickSaveBtnText}>저장</Text>
              </TouchableOpacity>
            </View>
            {nickError ? (
              <Text style={styles.nickErrorText}>⚠ {nickError}</Text>
            ) : null}
          </View>
        ) : (
          <TouchableOpacity onPress={() => { setNickname(profile.nickname); setNickError(''); setEditingNick(true); }}>
            <Text style={styles.nickname}>{profile.nickname} ✏️</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.providerBadge}>
          <Text style={styles.providerText}>
            {profile.provider === 'google.com' ? '🟦 Google 계정'
              : profile.provider === 'apple.com' ? '⬛ Apple 계정'
              : '📧 이메일 계정'}
          </Text>
        </View>
      </View>

      {/* 계정 설정 */}
      <Text style={styles.sectionTitle}>계정 설정</Text>

      {isEmailUser && (
        <TouchableOpacity style={styles.menuItem} onPress={() => setPwModal(true)}>
          <Text style={styles.menuIcon}>🔑</Text>
          <Text style={styles.menuLabel}>비밀번호 변경</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
        <Text style={styles.menuIcon}>🚪</Text>
        <Text style={styles.menuLabel}>로그아웃</Text>
        <Text style={styles.menuArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={handleDeleteAccount}>
        <Text style={styles.menuIcon}>⚠️</Text>
        <Text style={[styles.menuLabel, styles.menuLabelDanger]}>계정 삭제</Text>
        <Text style={styles.menuArrow}>›</Text>
      </TouchableOpacity>

      {/* 아바타 선택 모달 */}
      <Modal visible={avatarModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>아바타 선택</Text>
            <View style={styles.avatarGrid}>
              {AVATARS.map(emoji => (
                <TouchableOpacity key={emoji} style={[styles.avatarOption, profile.avatar === emoji && styles.avatarOptionActive]}
                  onPress={() => selectAvatar(emoji)}>
                  <Text style={styles.avatarOptionText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setAvatarModal(false)}>
              <Text style={styles.cancelBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 비밀번호 변경 모달 */}
      <Modal visible={pwModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>비밀번호 변경</Text>
            <TextInput style={styles.input} placeholder="현재 비밀번호" placeholderTextColor="#aaa"
              value={currentPw} onChangeText={setCurrentPw} secureTextEntry />
            <TextInput style={styles.input} placeholder="새 비밀번호 (6자 이상)" placeholderTextColor="#aaa"
              value={newPw} onChangeText={setNewPw} secureTextEntry />
            <TextInput style={styles.input} placeholder="새 비밀번호 확인" placeholderTextColor="#aaa"
              value={confirmPw} onChangeText={setConfirmPw} secureTextEntry />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setPwModal(false); setCurrentPw(''); setNewPw(''); setConfirmPw(''); }}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={changePassword}>
                <Text style={styles.confirmBtnText}>변경</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { padding: 20, paddingBottom: 60 },
  loadingText: { color: '#aaa', textAlign: 'center', marginTop: 80 },
  profileCard: {
    backgroundColor: '#16213e', borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 28, borderWidth: 1, borderColor: '#0f3460',
  },
  avatarBtn: { position: 'relative', marginBottom: 14 },
  avatarText: { fontSize: 72 },
  editAvatarBadge: {
    position: 'absolute', bottom: 0, right: -4,
    backgroundColor: '#0f3460', borderRadius: 12, padding: 4,
  },
  editAvatarText: { fontSize: 14 },
  nickEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  nickInput: {
    color: '#fff', fontSize: 20, fontWeight: 'bold',
    borderBottomWidth: 2, borderBottomColor: '#e94560',
    paddingBottom: 4, minWidth: 120, textAlign: 'center',
  },
  nickSaveBtn: { backgroundColor: '#e94560', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  nickSaveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  nickErrorText: { color: '#e94560', fontSize: 12, marginTop: 4, textAlign: 'center' },
  nickname: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 6 },
  email: { color: '#aaa', fontSize: 14, marginBottom: 6 },
  providerBadge: { backgroundColor: '#0f3460', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  providerText: { color: '#aaa', fontSize: 13 },
  sectionTitle: { color: '#aaa', fontSize: 13, fontWeight: 'bold', marginBottom: 12 },
  menuItem: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: '#0f3460',
  },
  menuItemDanger: { borderColor: 'rgba(233,69,96,0.3)' },
  menuIcon: { fontSize: 20, marginRight: 14 },
  menuLabel: { color: '#fff', fontSize: 15, flex: 1 },
  menuLabelDanger: { color: '#e94560' },
  menuArrow: { color: '#aaa', fontSize: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#16213e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  modalSubtitle: { color: '#aaa', fontSize: 13, lineHeight: 20, marginBottom: 16 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20, justifyContent: 'center' },
  avatarOption: {
    width: 56, height: 56, borderRadius: 12, backgroundColor: '#1a1a2e',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0f3460',
  },
  avatarOptionActive: { borderColor: '#e94560', backgroundColor: 'rgba(233,69,96,0.1)' },
  avatarOptionText: { fontSize: 30 },
  input: {
    backgroundColor: '#1a1a2e', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 12, fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  inputError: { borderColor: '#e94560', borderWidth: 1.5 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#0f3460', alignItems: 'center' },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
  confirmBtn: { flex: 1, backgroundColor: '#e94560', padding: 14, borderRadius: 10, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  btnDisabled: { opacity: 0.6 },
});

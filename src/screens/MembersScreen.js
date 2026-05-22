import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Share, Modal
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../config/firebase';

const ROLE_LABELS = { owner: '🚩 대표', editor: '✏️ 편집자', viewer: '👁 보기만' };

export default function MembersScreen({ route }) {
  const insets = useSafeAreaInsets();
  const { trip } = route.params;
  const [tripData, setTripData] = useState(trip);
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  const user = auth.currentUser;
  const isOwner = tripData.memberRoles?.[user.uid] === 'owner';
  const [memberProfiles, setMemberProfiles] = useState({});

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'trips', trip.id), async (snap) => {
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() };
      setTripData(data);

      // 멤버 닉네임 일괄 조회
      const members = data.members || [];
      const profiles = {};
      await Promise.all(members.map(async (uid) => {
        try {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) profiles[uid] = userSnap.data();
        } catch {}
      }));
      setMemberProfiles(profiles);
    });
    return unsubscribe;
  }, []);

  const shareInviteCode = async () => {
    await Share.share({
      message: `여행 "${tripData.name}"에 초대합니다!\n초대 코드: ${tripData.inviteCode}\n\n여행 플래너 앱에서 "코드로 참여"를 선택하고 위 코드를 입력하세요.`,
    });
  };

  const changeRole = async (role) => {
    if (!selectedMember) return;
    try {
      await updateDoc(doc(db, 'trips', trip.id), {
        [`memberRoles.${selectedMember}`]: role,
      });
    } catch (e) {
      Alert.alert('오류', '권한 변경에 실패했어요. 다시 시도해주세요.');
    } finally {
      setRoleModalVisible(false);
      setSelectedMember(null);
    }
  };

  const removeMember = async (memberId) => {
    if (memberId === user.uid) {
      Alert.alert('알림', '자신은 내보낼 수 없습니다.');
      return;
    }
    Alert.alert('멤버 내보내기', '이 멤버를 여행에서 내보낼까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '내보내기', style: 'destructive',
        onPress: async () => {
          try {
            const newMembers = tripData.members.filter(m => m !== memberId);
            const newRoles = { ...tripData.memberRoles };
            delete newRoles[memberId];
            await updateDoc(doc(db, 'trips', trip.id), {
              members: newMembers,
              memberRoles: newRoles,
            });
          } catch (e) {
            Alert.alert('오류', '멤버 내보내기에 실패했어요. 다시 시도해주세요.');
          }
        }
      }
    ]);
  };

  const members = tripData.members || [];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 20 }]}>
      {/* 초대 코드 카드 */}
      <View style={styles.inviteCard}>
        <Text style={styles.inviteLabel}>초대 코드</Text>
        <Text style={styles.inviteCode}>{tripData.inviteCode}</Text>
        <TouchableOpacity style={styles.shareBtn} onPress={shareInviteCode}>
          <Text style={styles.shareBtnText}>코드 공유하기 📤</Text>
        </TouchableOpacity>
      </View>

      {/* 공개 설정 */}
      {isOwner && (
        <TouchableOpacity
          style={styles.publicToggle}
          onPress={() => {
            const today = new Date().toISOString().slice(0, 10);
            if (!tripData.isPublic && (!tripData.endDate || tripData.endDate >= today)) {
              Alert.alert(
                '공유 불가',
                '다녀온 여행만 커뮤니티에 공유할 수 있어요.\n여행이 끝난 후 공유해주세요.'
              );
              return;
            }
            updateDoc(doc(db, 'trips', trip.id), { isPublic: !tripData.isPublic });
          }}
        >
          <View>
            <Text style={styles.publicToggleText}>
              커뮤니티 공개: {tripData.isPublic ? '🟢 공개' : '🔴 비공개'}
            </Text>
            <Text style={styles.publicToggleHint}>다녀온 여행만 공유 가능 · 탭하여 변경</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* 멤버 목록 */}
      <Text style={styles.sectionTitle}>멤버 ({members.length}명)</Text>
      <FlatList
        data={members}
        keyExtractor={item => item}
        renderItem={({ item: memberId }) => (
          <View style={styles.memberCard}>
            <View style={styles.memberLeft}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {memberProfiles[memberId]?.nickname
                    ? memberProfiles[memberId].nickname.slice(0, 1).toUpperCase()
                    : (memberId === user.uid ? '나' : '👤')}
                </Text>
              </View>
              <View>
                <Text style={styles.memberId}>
                  {memberId === user.uid
                    ? `${memberProfiles[memberId]?.nickname || '나'} (본인)`
                    : (memberProfiles[memberId]?.nickname || memberId.slice(0, 8) + '...')}
                </Text>
                <Text style={styles.memberRole}>
                  {ROLE_LABELS[tripData.memberRoles?.[memberId]] || ''}
                </Text>
              </View>
            </View>
            {isOwner && memberId !== user.uid && (
              <View style={styles.memberActions}>
                <TouchableOpacity
                  style={styles.roleBtn}
                  onPress={() => { setSelectedMember(memberId); setRoleModalVisible(true); }}
                >
                  <Text style={styles.roleBtnText}>권한 변경</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => removeMember(memberId)}
                >
                  <Text style={styles.removeBtnText}>내보내기</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />

      {/* 권한 변경 모달 */}
      <Modal visible={roleModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={styles.modalTitle}>권한 변경</Text>
            {['editor', 'viewer'].map(role => (
              <TouchableOpacity key={role} style={styles.roleOption} onPress={() => changeRole(role)}>
                <Text style={styles.roleOptionText}>{ROLE_LABELS[role]}</Text>
                <Text style={styles.roleOptionDesc}>
                  {role === 'editor' ? '일정, 비용 추가/수정 가능' : '보기만 가능'}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRoleModalVisible(false)}>
              <Text style={styles.cancelBtnText}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  inviteCard: {
    backgroundColor: '#0f3460', borderRadius: 14, padding: 20,
    alignItems: 'center', marginBottom: 16,
  },
  inviteLabel: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  inviteCode: { color: '#fff', fontSize: 32, fontWeight: 'bold', letterSpacing: 6, marginBottom: 14 },
  shareBtn: { backgroundColor: '#e94560', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  shareBtnText: { color: '#fff', fontWeight: 'bold' },
  publicToggle: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, borderWidth: 1, borderColor: '#0f3460',
  },
  publicToggleText: { color: '#fff', fontSize: 15 },
  publicToggleHint: { color: '#aaa', fontSize: 12 },
  sectionTitle: { color: '#aaa', fontSize: 14, marginBottom: 12 },
  memberCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', borderWidth: 1, borderColor: '#0f3460',
  },
  memberLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#0f3460',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  memberId: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  memberRole: { color: '#aaa', fontSize: 12, marginTop: 2 },
  memberActions: { flexDirection: 'row', gap: 8 },
  roleBtn: {
    backgroundColor: '#0f3460', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  roleBtnText: { color: '#fff', fontSize: 12 },
  removeBtn: {
    backgroundColor: 'rgba(233,69,96,0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  removeBtnText: { color: '#e94560', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 30 },
  modal: { backgroundColor: '#16213e', borderRadius: 16, padding: 24 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  roleOption: {
    backgroundColor: '#1a1a2e', borderRadius: 10, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: '#0f3460',
  },
  roleOptionText: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  roleOptionDesc: { color: '#aaa', fontSize: 13 },
  cancelBtn: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#0f3460', alignItems: 'center', marginTop: 4 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});

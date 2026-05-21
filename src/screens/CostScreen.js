import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, TextInput, Alert, ScrollView,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, addDoc, onSnapshot, query, where,
  deleteDoc, doc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';

const CURRENCIES = [
  { code: 'KRW', symbol: '₩',  flag: '🇰🇷' },
  { code: 'USD', symbol: '$',  flag: '🇺🇸' },
  { code: 'JPY', symbol: '¥',  flag: '🇯🇵' },
  { code: 'EUR', symbol: '€',  flag: '🇪🇺' },
  { code: 'CNY', symbol: '¥',  flag: '🇨🇳' },
  { code: 'THB', symbol: '฿',  flag: '🇹🇭' },
  { code: 'VND', symbol: '₫',  flag: '🇻🇳' },
  { code: 'GBP', symbol: '£',  flag: '🇬🇧' },
];

const CATEGORIES = ['숙소', '교통', '식비', '관광', '쇼핑', '기타'];
const COST_ACTION_W = 140;

// ── 지출 항목 카드 ──────────────────────────────────────────
function CostItemCard({ item, editMode, onEdit, onDelete, symOf, toKRW, hasExchange }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const cur = item.currency || 'KRW';
  const amt = item.cost || item.amount || 0;
  const isManual = item.source === 'manual';

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: (editMode && isManual) ? -COST_ACTION_W : 0,
      useNativeDriver: true, friction: 8, tension: 60,
    }).start();
  }, [editMode]);

  return (
    <View style={cStyles.cardWrapper}>
      {editMode && isManual && (
        <View style={cStyles.actionRow}>
          <TouchableOpacity style={cStyles.editBtn} onPress={() => onEdit(item)}>
            <Text style={cStyles.editBtnIcon}>✏️</Text>
            <Text style={cStyles.editBtnText}>수정</Text>
          </TouchableOpacity>
          <TouchableOpacity style={cStyles.deleteBtn} onPress={() => onDelete(item.id)}>
            <Text style={cStyles.deleteBtnIcon}>🗑</Text>
            <Text style={cStyles.deleteBtnText}>삭제</Text>
          </TouchableOpacity>
        </View>
      )}
      <Animated.View style={{ transform: [{ translateX }] }}>
        <View style={[cStyles.costCard, hasExchange && cStyles.costCardTracked]}>
          <View style={cStyles.costLeft}>
            <View style={cStyles.costTagRow}>
              <Text style={cStyles.costCategory}>{item.category || '일정 비용'}</Text>
              {item.source === 'schedule' && (
                <View style={cStyles.schedBadge}><Text style={cStyles.schedBadgeText}>📅 일정</Text></View>
              )}
              {hasExchange && (
                <View style={cStyles.cashBadge}><Text style={cStyles.cashBadgeText}>👛 지갑</Text></View>
              )}
            </View>
            <Text style={cStyles.costTitle}>{item.title}</Text>
            {item.date && <Text style={cStyles.costDate}>{item.date}{item.time ? ` ${item.time}` : ''}</Text>}
          </View>
          <View style={cStyles.costRight}>
            <Text style={cStyles.costAmount}>{symOf(cur)}{Number(amt).toLocaleString()}</Text>
            {cur !== 'KRW' && (
              <Text style={cStyles.krwAmount}>≈ ₩{Math.round(toKRW(amt, cur)).toLocaleString()}</Text>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ── 유틸 ──────────────────────────────────────────────────
const nowDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

export default function CostScreen({ route }) {
  const insets = useSafeAreaInsets();
  const { trip } = route.params;

  const [manualCosts,   setManualCosts]   = useState([]);
  const [scheduleCosts, setScheduleCosts] = useState([]);
  const [exchanges,     setExchanges]     = useState([]);   // 환전 기록
  const [exchangeRates, setExchangeRates] = useState({});
  const [activeTab,     setActiveTab]     = useState('all');
  const [costEditMode,  setCostEditMode]  = useState(false);

  // 지출 모달
  const [addModal,       setAddModal]       = useState(false);
  const [editingCostId,  setEditingCostId]  = useState(null);
  const [title,          setTitle]          = useState('');
  const [amount,         setAmount]         = useState('');
  const [currency,       setCurrency]       = useState('KRW');
  const [category,       setCategory]       = useState('기타');
  const [costDate,       setCostDate]       = useState('');

  // 환전 모달
  const [cashModal,          setCashModal]          = useState(false);
  const [editingExchangeId,  setEditingExchangeId]  = useState(null);
  const [cashCurrency,       setCashCurrency]       = useState('JPY');
  const [cashAmount,         setCashAmount]         = useState('');
  const [cashRate,           setCashRate]           = useState('');
  const [cashMemo,           setCashMemo]           = useState('');

  const user    = auth.currentUser;
  const canEdit = ['owner', 'editor'].includes(trip.memberRoles?.[user.uid]);

  useEffect(() => {
    const q1 = query(collection(db, 'costs'), where('tripId', '==', trip.id));
    const unsub1 = onSnapshot(q1, snap =>
      setManualCosts(snap.docs.map(d => ({ id: d.id, source: 'manual', ...d.data() })))
    );
    const q2 = query(collection(db, 'schedules'), where('tripId', '==', trip.id));
    const unsub2 = onSnapshot(q2, snap =>
      setScheduleCosts(
        snap.docs.map(d => ({ id: d.id, source: 'schedule', ...d.data() })).filter(d => d.cost > 0)
      )
    );
    // 환전 기록: exchanges 컬렉션에서 tripId로 조회
    const q3 = query(collection(db, 'exchanges'), where('tripId', '==', trip.id));
    const unsub3 = onSnapshot(q3, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (a.date || '') > (b.date || '') ? -1 : 1);
      setExchanges(data);
    });
    fetchRates();
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const fetchRates = async () => {
    try {
      const res  = await fetch('https://api.exchangerate-api.com/v4/latest/KRW');
      const data = await res.json();
      setExchangeRates(data.rates);
    } catch {}
  };

  const toKRW = (amt, cur) => {
    if (!amt) return 0;
    if (cur === 'KRW' || !exchangeRates[cur]) return Number(amt);
    return Number(amt) / exchangeRates[cur];
  };

  const allCosts = [...manualCosts, ...scheduleCosts];

  const spentByCurrency = {};
  allCosts.forEach(c => {
    const cur = c.currency || 'KRW';
    const amt = c.cost || c.amount || 0;
    spentByCurrency[cur] = (spentByCurrency[cur] || 0) + Number(amt);
  });

  const totalKRW = allCosts.reduce((s, c) =>
    s + toKRW(c.cost || c.amount || 0, c.currency || 'KRW'), 0
  );

  const byCategoryKRW = CATEGORIES.reduce((acc, cat) => {
    const sum = allCosts.filter(c => (c.category || '기타') === cat)
      .reduce((s, c) => s + toKRW(c.cost || c.amount || 0, c.currency || 'KRW'), 0);
    if (sum > 0) acc[cat] = sum;
    return acc;
  }, {});

  // ── 일차 계산 ──
  const tripStart = trip.startDate;
  const tripEnd   = trip.endDate;
  const numDays   = (tripStart && tripEnd)
    ? Math.floor((new Date(tripEnd + 'T00:00:00') - new Date(tripStart + 'T00:00:00')) / 86400000) + 1
    : 0;

  // 날짜 → 일차(1-based). 범위 밖이거나 날짜 없으면 0
  const getDayNum = (dateStr) => {
    if (!dateStr || !tripStart || numDays <= 0) return 0;
    const diff = Math.floor(
      (new Date(dateStr + 'T00:00:00') - new Date(tripStart + 'T00:00:00')) / 86400000
    ) + 1;
    return (diff >= 1 && diff <= numDays) ? diff : 0;
  };

  // 필터 탭 목록
  const filterTabs = [
    { key: 'all', label: '전체' },
    ...Array.from({ length: numDays }, (_, i) => ({
      key: String(i + 1),
      label: `${i + 1}일차`,
    })),
    ...(numDays > 0 ? [{ key: '0', label: '미정' }] : []),
  ];

  const displayCosts = (() => {
    const sorted = allCosts.slice().sort((a, b) =>
      (a.date || '') > (b.date || '') ? 1 : -1
    );
    if (activeTab === 'all') return sorted;
    const dayNum = parseInt(activeTab, 10);
    return sorted.filter(c => getDayNum(c.date) === dayNum);
  })();

  // 통화별 총 환전액 (외화)
  const totalExchanged = (cur) =>
    exchanges.filter(e => e.currency === cur).reduce((s, e) => s + (e.foreignAmount || 0), 0);

  // 통화별 총 원화 환산액 (적용 환율 기반)
  const totalExchangedKRW = (cur) =>
    exchanges.filter(e => e.currency === cur).reduce((s, e) => s + (e.krwAmount || 0), 0);

  // 추적할 통화 목록
  const trackedCurrencies = Array.from(
    new Set([
      ...exchanges.map(e => e.currency),
      ...Object.keys(spentByCurrency).filter(c => c !== 'KRW'),
    ])
  );

  // ── 지출 CRUD ──
  const openAddModal = () => {
    setEditingCostId(null);
    setTitle(''); setAmount(''); setCurrency('KRW'); setCategory('기타');
    setCostDate(nowDateStr());
    setAddModal(true);
  };
  const openEditModal = (item) => {
    setEditingCostId(item.id);
    setTitle(item.title || '');
    setAmount(String(item.amount || item.cost || ''));
    setCurrency(item.currency || 'KRW');
    setCategory(item.category || '기타');
    setCostDate(item.date || nowDateStr());
    setAddModal(true);
  };
  const saveCost = async () => {
    if (!title.trim() || !amount.trim()) {
      Alert.alert('알림', '항목명과 금액을 입력해주세요.'); return;
    }
    const dayLabel = costDate && getDayNum(costDate) > 0
      ? `${getDayNum(costDate)}일차`
      : null;
    if (editingCostId) {
      await updateDoc(doc(db, 'costs', editingCostId), {
        title: title.trim(), amount: Number(amount), currency, category,
        date: costDate || null, dayLabel,
      });
    } else {
      await addDoc(collection(db, 'costs'), {
        tripId: trip.id, title: title.trim(),
        amount: Number(amount), currency, category,
        date: costDate || null, dayLabel,
        createdAt: serverTimestamp(),
      });
    }
    setTitle(''); setAmount(''); setCurrency('KRW'); setCategory('기타');
    setCostDate('');
    setEditingCostId(null); setAddModal(false);
  };
  const deleteCost = (id) => {
    Alert.alert('삭제', '이 항목을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => deleteDoc(doc(db, 'costs', id)) },
    ]);
  };

  // ── 환전 CRUD ──
  const openCashModal = (cur = 'JPY') => {
    setEditingExchangeId(null);
    setCashCurrency(cur); setCashAmount(''); setCashRate(''); setCashMemo('');
    setCashModal(true);
  };
  const openEditExchange = (entry) => {
    setEditingExchangeId(entry.id);
    setCashCurrency(entry.currency);
    setCashAmount(String(entry.foreignAmount));
    setCashRate(String(entry.rate || ''));
    setCashMemo(entry.memo || '');
    setCashModal(true);
  };
  const saveExchange = async () => {
    const amt  = parseFloat(cashAmount);
    const rate = parseFloat(cashRate);
    if (!cashAmount || isNaN(amt) || amt <= 0) {
      Alert.alert('알림', '환전 금액을 입력해주세요.'); return;
    }
    if (!cashRate || isNaN(rate) || rate <= 0) {
      Alert.alert('알림', '적용 환율을 입력해주세요.\n예) 1 JPY = 9.2 원이면 9.2 입력'); return;
    }
    const krwAmount = Math.round(amt * rate);
    const docData = {
      currency: cashCurrency,
      foreignAmount: amt,
      rate,
      krwAmount,
      memo: cashMemo.trim(),
    };
    if (editingExchangeId) {
      await updateDoc(doc(db, 'exchanges', editingExchangeId), docData);
    } else {
      await addDoc(collection(db, 'exchanges'), {
        uid: user.uid,
        tripId: trip.id,
        ...docData,
        date: nowDateStr(),
        createdAt: serverTimestamp(),
      });
    }
    setCashModal(false);
    setCashAmount(''); setCashRate(''); setCashMemo('');
    setEditingExchangeId(null);
  };
  const deleteExchangeRecord = (id) => {
    Alert.alert('삭제', '이 환전 기록을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => deleteDoc(doc(db, 'exchanges', id)) },
    ]);
  };

  const symOf  = (code) => CURRENCIES.find(c => c.code === code)?.symbol || '';
  const flagOf = (code) => CURRENCIES.find(c => c.code === code)?.flag   || '';

  // 환전 모달 원화 미리보기
  const cashKRWPreview = () => {
    const amt  = parseFloat(cashAmount);
    const rate = parseFloat(cashRate);
    if (!isNaN(amt) && amt > 0 && !isNaN(rate) && rate > 0)
      return `₩${Math.round(amt * rate).toLocaleString('ko-KR')}`;
    return null;
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── 총 지출 카드 ── */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>총 지출 (원화 환산)</Text>
          <Text style={styles.totalAmount}>₩{Math.round(totalKRW).toLocaleString('ko-KR')}</Text>
          {Object.keys(byCategoryKRW).length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {Object.entries(byCategoryKRW).map(([cat, val]) => (
                <View key={cat} style={styles.catChip}>
                  <Text style={styles.catChipLabel}>{cat}</Text>
                  <Text style={styles.catChipVal}>₩{Math.round(val).toLocaleString()}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* ── 환전 금액 관리 ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>👛 지갑 · 환전 관리</Text>
          {canEdit && (
            <TouchableOpacity style={styles.addCashBtn} onPress={() => openCashModal()}>
              <Text style={styles.addCashBtnText}>+ 추가</Text>
            </TouchableOpacity>
          )}
        </View>

        {trackedCurrencies.length === 0 ? (
          <View style={styles.cashEmptyBox}>
            <Text style={styles.cashEmptyText}>
              환전한 금액을 등록하면{'\n'}잔액을 자동으로 계산해드려요
            </Text>
            {canEdit && (
              <TouchableOpacity style={styles.cashEmptyBtn} onPress={() => openCashModal()}>
                <Text style={styles.cashEmptyBtnText}>환전 금액 등록하기</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          trackedCurrencies.map(cur => {
            const curExchanges = exchanges.filter(e => e.currency === cur);
            const exchanged    = totalExchanged(cur);
            const exchangedKRW = totalExchangedKRW(cur);
            const spent        = spentByCurrency[cur] || 0;
            const remaining    = exchanged - spent;
            const progress     = exchanged > 0 ? Math.min(spent / exchanged, 1) : 0;
            const isOver       = remaining < 0;

            return (
              <View key={cur} style={styles.cashCard}>
                {/* 통화 헤더 */}
                <View style={styles.cashCardHeader}>
                  <Text style={styles.cashFlag}>{flagOf(cur)}</Text>
                  <Text style={styles.cashCur}>{cur}</Text>
                  <View style={{ flex: 1 }} />
                  <View style={styles.cashSummary}>
                    {exchanged > 0 ? (
                      <>
                        <Text style={styles.cashTotalExchanged}>
                          총 환전 {symOf(cur)}{exchanged.toLocaleString()}
                        </Text>
                        {exchangedKRW > 0 && (
                          <Text style={styles.cashKRWHint}>≈ ₩{exchangedKRW.toLocaleString()}</Text>
                        )}
                        <Text style={[styles.cashRemaining, isOver && styles.cashOver]}>
                          {isOver ? '⚠️ ' : ''}잔액 {symOf(cur)}{Math.abs(remaining).toLocaleString()}
                          {isOver ? ' 초과' : ''}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.cashNoExchange}>환전 미등록</Text>
                    )}
                  </View>
                </View>

                {/* 프로그레스 바 */}
                {exchanged > 0 && (
                  <View style={styles.progressWrap}>
                    <View style={styles.progressBar}>
                      <View style={[
                        styles.progressFill,
                        { width: `${Math.min(progress * 100, 100)}%` },
                        isOver && styles.progressFillOver,
                      ]} />
                    </View>
                    <Text style={styles.progressSpent}>
                      사용 {symOf(cur)}{spent.toLocaleString()}
                    </Text>
                  </View>
                )}

                {/* 환전 기록 목록 */}
                {curExchanges.length > 0 && (
                  <View style={styles.recordsBox}>
                    <Text style={styles.recordsLabel}>환전 내역</Text>
                    {curExchanges.map((entry) => (
                      <View key={entry.id} style={styles.recordRow}>
                        <View style={styles.recordLeft}>
                          <Text style={styles.recordAmount}>
                            +{symOf(cur)}{(entry.foreignAmount || 0).toLocaleString()}
                          </Text>
                          {entry.rate ? (
                            <Text style={styles.recordRate}>
                              1 {cur} = {entry.rate.toLocaleString('ko-KR')} 원
                              {'  '}→{'  '}₩{(entry.krwAmount || 0).toLocaleString()}
                            </Text>
                          ) : null}
                          {entry.date ? (
                            <Text style={styles.recordDateTime}>{entry.date}</Text>
                          ) : null}
                          {entry.memo ? (
                            <Text style={styles.recordMemo}>📝 {entry.memo}</Text>
                          ) : null}
                        </View>
                        {canEdit && (
                          <View style={styles.recordActions}>
                            <TouchableOpacity
                              style={styles.recordEditBtn}
                              onPress={() => openEditExchange(entry)}
                            >
                              <Text style={styles.recordEditText}>✏️</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.recordDeleteBtn}
                              onPress={() => deleteExchangeRecord(entry.id)}
                            >
                              <Text style={styles.recordDeleteText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {canEdit && (
                  <TouchableOpacity
                    style={styles.addRecordBtn}
                    onPress={() => openCashModal(cur)}
                  >
                    <Text style={styles.addRecordBtnText}>+ 환전 추가</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}

        {/* ── 지출 목록 ── */}
        <View style={[styles.sectionHeader, { marginTop: 20 }]}>
          <Text style={styles.sectionTitle}>📋 지출 내역</Text>
          {canEdit && manualCosts.length > 0 && (
            <TouchableOpacity
              style={[styles.editModeBtn, costEditMode && styles.editModeBtnActive]}
              onPress={() => setCostEditMode(prev => !prev)}
            >
              <Text style={[styles.editModeBtnText, costEditMode && styles.editModeBtnTextActive]}>
                {costEditMode ? '완료' : '편집'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {costEditMode && (
          <View style={styles.editModeBar}>
            <Text style={styles.editModeBarText}>← 수동 항목을 밀면 수정·삭제 버튼이 나타나요</Text>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={{ paddingRight: 8 }}
        >
          {filterTabs.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterBtn, activeTab === key && styles.filterBtnActive]}
              onPress={() => setActiveTab(key)}
            >
              <Text style={[styles.filterText, activeTab === key && styles.filterTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {displayCosts.length === 0 ? (
          <Text style={styles.emptyText}>지출 내역이 없어요.</Text>
        ) : (
          displayCosts.map(item => (
            <CostItemCard
              key={item.id}
              item={item}
              editMode={costEditMode}
              onEdit={openEditModal}
              onDelete={deleteCost}
              symOf={symOf}
              toKRW={toKRW}
              hasExchange={totalExchanged(item.currency || 'KRW') > 0}
            />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {canEdit && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 20 }]}
          onPress={openAddModal}
        >
          <Text style={styles.fabText}>+ 수동 추가</Text>
        </TouchableOpacity>
      )}

      {/* ── 지출 추가/수정 모달 ── */}
      <Modal visible={addModal} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.modalTitle}>{editingCostId ? '지출 수정' : '지출 수동 추가'}</Text>
                <TextInput style={styles.input} placeholder="항목명 *" placeholderTextColor="#aaa"
                  value={title} onChangeText={setTitle} />
                <TextInput style={styles.input} placeholder="금액 *" placeholderTextColor="#aaa"
                  value={amount} onChangeText={setAmount} keyboardType="numeric" />
                {/* 날짜 → 일차 자동 계산 */}
                <View style={styles.dateRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="날짜 (YYYY-MM-DD)"
                    placeholderTextColor="#aaa"
                    value={costDate}
                    onChangeText={setCostDate}
                  />
                  {costDate && getDayNum(costDate) > 0 && (
                    <View style={styles.dayBadge}>
                      <Text style={styles.dayBadgeText}>{getDayNum(costDate)}일차</Text>
                    </View>
                  )}
                </View>
                <View style={{ height: 12 }} />
                <Text style={styles.inputLabel}>통화</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                  {CURRENCIES.map(c => (
                    <TouchableOpacity key={c.code}
                      style={[styles.chip, currency === c.code && styles.chipActive]}
                      onPress={() => setCurrency(c.code)}>
                      <Text style={[styles.chipText, currency === c.code && styles.chipTextActive]}>
                        {c.flag} {c.code}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={styles.inputLabel}>카테고리</Text>
                <View style={styles.categoryRow}>
                  {CATEGORIES.map(cat => (
                    <TouchableOpacity key={cat}
                      style={[styles.chip, category === cat && styles.chipActive]}
                      onPress={() => setCategory(cat)}>
                      <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddModal(false)}>
                    <Text style={styles.cancelBtnText}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.confirmBtn} onPress={saveCost}>
                    <Text style={styles.confirmBtnText}>{editingCostId ? '수정' : '추가'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 환전 추가/수정 모달 ── */}
      <Modal visible={cashModal} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.modalTitle}>
                  {editingExchangeId ? '👛 환전 내역 수정' : '👛 환전 금액 추가'}
                </Text>

                {/* 통화 선택 */}
                <Text style={styles.inputLabel}>통화 선택</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                  {CURRENCIES.filter(c => c.code !== 'KRW').map(c => (
                    <TouchableOpacity key={c.code}
                      style={[styles.chip, cashCurrency === c.code && styles.chipActive]}
                      onPress={() => setCashCurrency(c.code)}>
                      <Text style={[styles.chipText, cashCurrency === c.code && styles.chipTextActive]}>
                        {c.flag} {c.code}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* 환전 금액 */}
                <TextInput
                  style={styles.input}
                  placeholder={`환전한 ${cashCurrency} 금액 *`}
                  placeholderTextColor="#aaa"
                  value={cashAmount}
                  onChangeText={setCashAmount}
                  keyboardType="numeric"
                />

                {/* 적용 환율 */}
                <TextInput
                  style={styles.input}
                  placeholder={`적용 환율 (1 ${cashCurrency} = ? 원) *`}
                  placeholderTextColor="#aaa"
                  value={cashRate}
                  onChangeText={setCashRate}
                  keyboardType="numeric"
                />

                {/* 원화 환산 미리보기 */}
                {cashKRWPreview() && (
                  <View style={styles.cashPreviewBox}>
                    <Text style={styles.cashPreviewLabel}>원화 환산 금액</Text>
                    <Text style={styles.cashPreviewValue}>{cashKRWPreview()}</Text>
                  </View>
                )}

                {/* 메모 */}
                <TextInput
                  style={styles.input}
                  placeholder="메모 (선택) — 예: 공항 환전소"
                  placeholderTextColor="#aaa"
                  value={cashMemo}
                  onChangeText={setCashMemo}
                />

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setCashModal(false)}>
                    <Text style={styles.cancelBtnText}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.confirmBtn} onPress={saveExchange}>
                    <Text style={styles.confirmBtnText}>{editingExchangeId ? '수정' : '추가'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── 스타일 ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { padding: 16 },

  totalCard: { backgroundColor: '#0f3460', borderRadius: 14, padding: 18, marginBottom: 16 },
  totalLabel: { color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 4 },
  totalAmount: { color: '#fff', fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 },
  catChip: {
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, alignItems: 'center',
  },
  catChipLabel: { color: '#aaa', fontSize: 11, marginBottom: 2 },
  catChipVal:   { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle:  { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  addCashBtn:     { backgroundColor: '#0f3460', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  addCashBtnText: { color: '#4a9eff', fontSize: 13, fontWeight: 'bold' },

  cashEmptyBox: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 20,
    alignItems: 'center', borderWidth: 1, borderColor: '#0f3460',
    borderStyle: 'dashed', marginBottom: 16,
  },
  cashEmptyText: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  cashEmptyBtn:  { backgroundColor: '#0f3460', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16 },
  cashEmptyBtnText: { color: '#4a9eff', fontSize: 13 },

  cashCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: '#0f3460',
  },
  cashCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cashFlag:       { fontSize: 24, marginRight: 8 },
  cashCur:        { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cashSummary:    { alignItems: 'flex-end' },
  cashTotalExchanged: { color: '#aaa', fontSize: 11, marginBottom: 1 },
  cashKRWHint:    { color: '#4a9eff', fontSize: 11, marginBottom: 2 },
  cashRemaining:  { color: '#4aff91', fontSize: 14, fontWeight: 'bold' },
  cashOver:       { color: '#e94560' },
  cashNoExchange: { color: '#555', fontSize: 12 },

  progressWrap: { marginBottom: 10 },
  progressBar:  { height: 6, backgroundColor: '#0f3460', borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', backgroundColor: '#4aff91', borderRadius: 3 },
  progressFillOver: { backgroundColor: '#e94560' },
  progressSpent: { color: '#e94560', fontSize: 11, textAlign: 'right' },

  recordsBox: {
    backgroundColor: '#1a1a2e', borderRadius: 10, padding: 10,
    marginBottom: 10, borderWidth: 1, borderColor: '#0f3460',
  },
  recordsLabel: { color: '#555', fontSize: 11, marginBottom: 8 },
  recordRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(15,52,96,0.5)',
  },
  recordLeft:    { flex: 1 },
  recordAmount:  { color: '#4aff91', fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  recordRate:    { color: '#4a9eff', fontSize: 12, marginBottom: 1 },
  recordDateTime:{ color: '#555', fontSize: 11, marginBottom: 1 },
  recordMemo:    { color: '#666', fontSize: 11 },
  recordActions: { flexDirection: 'row', gap: 4, alignItems: 'center', paddingLeft: 8 },
  recordEditBtn: {
    backgroundColor: 'rgba(74,158,255,0.15)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  recordEditText:   { fontSize: 14 },
  recordDeleteBtn:  { padding: 5 },
  recordDeleteText: { color: '#555', fontSize: 14 },

  addRecordBtn: {
    backgroundColor: 'rgba(74,158,255,0.1)', borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.3)',
  },
  addRecordBtnText: { color: '#4a9eff', fontSize: 13, fontWeight: 'bold' },

  filterRow: { marginBottom: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#0f3460', marginRight: 8 },
  filterBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  filterText:      { color: '#aaa', fontSize: 13 },
  filterTextActive:{ color: '#fff', fontWeight: 'bold' },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dayBadge: { backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  dayBadgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  emptyText: { color: '#aaa', textAlign: 'center', marginTop: 20, fontSize: 15 },

  fab: {
    position: 'absolute', right: 20,
    backgroundColor: '#e94560', paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 30, elevation: 5,
  },
  fabText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal:        { backgroundColor: '#16213e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle:   { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 18 },
  input: {
    backgroundColor: '#1a1a2e', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 12, fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  inputLabel: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#0f3460', marginRight: 8 },
  chipActive:    { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText:      { color: '#aaa', fontSize: 13 },
  chipTextActive:{ color: '#fff' },
  categoryRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },

  cashPreviewBox: {
    backgroundColor: 'rgba(233,69,96,0.12)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)',
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  cashPreviewLabel: { color: '#e94560', fontSize: 13 },
  cashPreviewValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  modalBtns:  { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:  { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#0f3460', alignItems: 'center' },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
  confirmBtn:    { flex: 1, backgroundColor: '#e94560', padding: 14, borderRadius: 10, alignItems: 'center' },
  confirmBtnText:{ color: '#fff', fontSize: 15, fontWeight: 'bold' },

  editModeBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1, borderColor: '#0f3460', backgroundColor: '#16213e',
  },
  editModeBtnActive:     { backgroundColor: '#e94560', borderColor: '#e94560' },
  editModeBtnText:       { color: '#aaa', fontSize: 13, fontWeight: 'bold' },
  editModeBtnTextActive: { color: '#fff' },
  editModeBar: {
    backgroundColor: 'rgba(233,69,96,0.08)', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.2)',
  },
  editModeBarText: { color: '#e94560', fontSize: 11, textAlign: 'center' },
});

// ── CostItemCard 전용 스타일 ──────────────────────────────────
const cStyles = StyleSheet.create({
  cardWrapper: { marginBottom: 10, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  actionRow: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 140, flexDirection: 'row' },
  editBtn:   { flex: 1, backgroundColor: '#4a9eff', justifyContent: 'center', alignItems: 'center' },
  editBtnIcon: { fontSize: 16, marginBottom: 2 },
  editBtnText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  deleteBtn:   { flex: 1, backgroundColor: '#e94560', justifyContent: 'center', alignItems: 'center' },
  deleteBtnIcon: { fontSize: 16, marginBottom: 2 },
  deleteBtnText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  costCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', borderWidth: 1, borderColor: '#0f3460',
  },
  costCardTracked: { borderColor: 'rgba(74,158,255,0.4)' },
  costLeft:   { flex: 1 },
  costTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  costCategory: { color: '#e94560', fontSize: 11 },
  schedBadge: { backgroundColor: 'rgba(74,158,255,0.2)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  schedBadgeText: { color: '#4a9eff', fontSize: 10 },
  cashBadge:  { backgroundColor: 'rgba(74,255,145,0.15)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  cashBadgeText: { color: '#4aff91', fontSize: 10 },
  costTitle:  { color: '#fff', fontSize: 14 },
  costDate:   { color: '#666', fontSize: 11, marginTop: 2 },
  costRight:  { alignItems: 'flex-end' },
  costAmount: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  krwAmount:  { color: '#aaa', fontSize: 11, marginTop: 2 },
});

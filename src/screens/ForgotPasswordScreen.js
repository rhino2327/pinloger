import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../config/firebase';

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleReset = async () => {
    setError('');
    if (!email.trim()) { setError('이메일을 입력해주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('올바른 이메일 형식이 아닙니다.'); return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        setError('등록되지 않은 이메일입니다.');
      } else if (e.code === 'auth/too-many-requests') {
        setError('잠시 후 다시 시도해주세요.');
      } else {
        setError('오류가 발생했어요. 다시 시도해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← 로그인으로 돌아가기</Text>
        </TouchableOpacity>

        <Text style={styles.title}>비밀번호 찾기</Text>

        {sent ? (
          <View style={styles.doneBox}>
            <Text style={styles.doneTitle}>메일을 보냈어요!</Text>
            <Text style={styles.doneMsg}>
              {email.trim()}으로{'\n'}비밀번호 재설정 링크를 발송했어요.{'\n'}메일함을 확인해주세요.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.primaryBtnText}>로그인 화면으로</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.subtitle}>
              가입한 이메일 주소를 입력하시면{'\n'}비밀번호 재설정 링크를 보내드립니다.
            </Text>
            <TextInput
              style={[styles.input, error ? styles.inputError : null]}
              placeholder="이메일 주소"
              placeholderTextColor="#666"
              value={email}
              onChangeText={t => { setEmail(t); setError(''); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleReset}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>재설정 메일 받기</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { padding: 28, paddingTop: 20, paddingBottom: 40 },
  backBtn: { marginBottom: 30 },
  backText: { color: '#aaa', fontSize: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { color: '#666', fontSize: 13, lineHeight: 20, marginBottom: 28 },
  input: {
    backgroundColor: '#16213e', color: '#fff', padding: 15,
    borderRadius: 12, marginBottom: 8, fontSize: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  inputError: { borderColor: '#e94560', borderWidth: 1.5 },
  errorText: { color: '#e94560', fontSize: 12, marginBottom: 12, marginLeft: 2 },
  primaryBtn: {
    backgroundColor: '#e94560', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  doneBox: { alignItems: 'center', paddingTop: 40 },
  doneTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  doneMsg: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
});

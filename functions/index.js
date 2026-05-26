const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten }  = require('firebase-functions/v2/firestore');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { setGlobalOptions }   = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'asia-northeast3' });

// ──────────────────────────────────────────────
// 공통 헬퍼: 멤버 전체에 FCM 발송
// ──────────────────────────────────────────────
async function sendToMembers(db, members, { title, body, data = {} }) {
  const tokens = [];
  await Promise.all(members.map(async (uid) => {
    try {
      const snap = await db.collection('users').doc(uid).get();
      const token = snap.data()?.pushToken;
      if (token) tokens.push(token);
    } catch {}
  }));
  if (tokens.length === 0) return;

  const messaging = admin.messaging();
  await Promise.all(tokens.map(token =>
    messaging.send({
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: { channelId: 'schedule', priority: 'high' },
      apns:    { payload: { aps: { sound: 'default' } } },
    }).catch(() => null)
  ));
}

// KST 날짜 문자열 반환 (YYYY-MM-DD)
function todayKST() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// KST 현재 분 반환
function nowMinutesKST() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return d.getHours() * 60 + d.getMinutes();
}

// ──────────────────────────────────────────────
// Kakao OAuth 로그인
// ──────────────────────────────────────────────
exports.kakaoLogin = onCall({ secrets: ['KAKAO_REST_API_KEY'] }, async (request) => {
  const { code, redirectUri } = request.data;
  if (!code || !redirectUri)
    throw new HttpsError('invalid-argument', 'code와 redirectUri가 필요합니다.');

  const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
  if (!KAKAO_REST_API_KEY)
    throw new HttpsError('internal', '서버 설정 오류: Kakao API 키가 없습니다.');

  const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: [
      'grant_type=authorization_code',
      `client_id=${KAKAO_REST_API_KEY}`,
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
      `code=${code}`,
    ].join('&'),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token)
    throw new HttpsError('unauthenticated', `Kakao 토큰 발급 실패: ${tokenData.error_description || 'unknown'}`);

  const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const kakaoUser = await userRes.json();
  if (!kakaoUser.id)
    throw new HttpsError('unauthenticated', '카카오 사용자 정보 조회 실패');

  const kakaoId      = String(kakaoUser.id);
  const email        = kakaoUser.kakao_account?.email;
  const nickname     = kakaoUser.kakao_account?.profile?.nickname || '카카오 사용자';
  const profileImage = kakaoUser.kakao_account?.profile?.profile_image_url || null;
  const uid          = `kakao:${kakaoId}`;

  const customToken = await admin.auth().createCustomToken(uid, {
    provider: 'kakao', kakaoId, nickname,
    email: email || `kakao_${kakaoId}@kakao.pinloger`,
  });

  const db = admin.firestore();
  await db.collection('users').doc(uid).set({
    uid, provider: 'kakao', kakaoId, nickname,
    email: email || `kakao_${kakaoId}@kakao.pinloger`,
    profileImage,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { customToken, uid, nickname, profileImage };
});

// ──────────────────────────────────────────────
// 일정 변경 시 멤버 전체 푸시 알림
// ──────────────────────────────────────────────
exports.notifyScheduleChange = onDocumentWritten(
  { document: 'schedules/{scheduleId}', region: 'asia-northeast3' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();

    let changeType;
    if (!before && after)      changeType = 'create';
    else if (before && !after) changeType = 'delete';
    else                       changeType = 'update';

    const schedule = after || before;
    if (!schedule?.tripId) return;

    const msgMap = {
      create: `📅 새 일정 추가: "${schedule.title || '일정'}"`,
      update: `✏️ 일정 수정: "${schedule.title || '일정'}"`,
      delete: `🗑️ 일정 삭제: "${schedule.title || '일정'}"`,
    };

    const db       = admin.firestore();
    const tripSnap = await db.collection('trips').doc(schedule.tripId).get();
    if (!tripSnap.exists) return;

    const changerUid = changeType === 'delete'
      ? (before?.updatedBy || null)
      : (after?.updatedBy  || after?.createdBy || null);
    const members = (tripSnap.data().members || []).filter(m => m !== changerUid);

    await sendToMembers(db, members, {
      title: `📍 ${tripSnap.data().name || '여행'}`,
      body:  msgMap[changeType],
    });
  }
);

// ──────────────────────────────────────────────
// 여행 시작/종료 D-day 알림 (30분마다 실행)
// ──────────────────────────────────────────────
exports.notifyTripMilestones = onSchedule(
  { schedule: 'every 30 minutes', region: 'asia-northeast3', timeZone: 'Asia/Seoul' },
  async () => {
    const db      = admin.firestore();
    const today   = todayKST();
    const nowMins = nowMinutesKST();

    // ① 여행 첫날: 첫 번째 일정 1시간 전 알림
    const startTrips = await db.collection('trips').where('startDate', '==', today).get();
    for (const tripDoc of startTrips.docs) {
      const trip = { id: tripDoc.id, ...tripDoc.data() };
      if (trip.startNotifiedAt === today) continue;

      const schedSnap = await db.collection('schedules')
        .where('tripId', '==', trip.id)
        .where('date', '==', today)
        .get();

      const times = schedSnap.docs
        .map(d => d.data().time).filter(Boolean).sort();
      if (!times.length) continue;

      const [fh, fm]  = times[0].split(':').map(Number);
      const firstMins = fh * 60 + fm;
      const diff      = firstMins - nowMins; // 양수 = 앞으로 남은 분

      if (diff < 45 || diff > 75) continue; // 45~75분 창 (30분 주기 허용)

      const dest = trip.destination || trip.name || '여행지';
      await sendToMembers(db, trip.members || [], {
        title: '✈️ 여행 출발 D-DAY!',
        body:  `${dest}로 떠나는 첫째날이에요! 즐거운 여행이 되길 바랍니다 🎉`,
        data:  { action: 'open_trip', tripId: trip.id },
      });
      await tripDoc.ref.update({ startNotifiedAt: today });
    }

    // ② 여행 마지막날: 마지막 일정 종료 1시간 후 공유 알림
    const endTrips = await db.collection('trips').where('endDate', '==', today).get();
    for (const tripDoc of endTrips.docs) {
      const trip = { id: tripDoc.id, ...tripDoc.data() };
      if (trip.endNotifiedAt === today) continue;

      const schedSnap = await db.collection('schedules')
        .where('tripId', '==', trip.id)
        .where('date', '==', today)
        .get();

      let lastTime = '20:00'; // 기본값
      if (!schedSnap.empty) {
        const times = schedSnap.docs
          .map(d => d.data().endTime || d.data().time).filter(Boolean).sort();
        if (times.length) lastTime = times[times.length - 1];
      }

      const [lh, lm] = lastTime.split(':').map(Number);
      const lastMins = lh * 60 + lm;
      const diff     = nowMins - lastMins; // 양수 = 지난 분

      if (diff < 45 || diff > 75) continue; // 마지막 일정 후 45~75분

      await sendToMembers(db, trip.members || [], {
        title: '🏠 여행이 끝났어요',
        body:  '즐거운 여행이었나요? 좋은 추억이었다면 커뮤니티에 공유해보세요! 📸',
        data:  { action: 'share_trip', tripId: trip.id },
      });
      await tripDoc.ref.update({ endNotifiedAt: today });
    }
  }
);

// ──────────────────────────────────────────────
// 항공편 조회 (AeroDataBox via RapidAPI)
// ──────────────────────────────────────────────
exports.lookupFlight = onCall({ secrets: ['RAPIDAPI_KEY'] }, async (request) => {
  const { flightNumber } = request.data;
  if (!flightNumber) throw new HttpsError('invalid-argument', '항공편 번호가 필요합니다.');

  const KEY = process.env.RAPIDAPI_KEY;
  if (!KEY) throw new HttpsError('internal', '서버 설정 오류');

  try {
    const fn  = flightNumber.trim().toUpperCase().replace(/\s/g, '');
    const url = `https://aerodatabox.p.rapidapi.com/flights/Number/${encodeURIComponent(fn)}`;

    const res  = await fetch(url, {
      headers: {
        'X-RapidAPI-Key':  KEY,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
    });
    const data = await res.json();

    if (!data || !Array.isArray(data) || data.length === 0) return { found: false };

    const f   = data[0];
    const dep = f.departure || {};
    const arr = f.arrival   || {};

    // 로컬 시간 문자열에서 HH:MM 추출
    // AeroDataBox 형식: "2024-01-15 10:30+09:00"
    const extractTime = (timeObj) => {
      const local = timeObj?.revisedTime?.local || timeObj?.scheduledTime?.local;
      if (!local) return '';
      const match = local.match(/(\d{2}:\d{2})/);
      return match ? match[1] : '';
    };

    // 지연 시간 계산 (분 단위)
    const calcDelay = (timeObj) => {
      const sch = timeObj?.scheduledTime?.utc;
      const rev = timeObj?.revisedTime?.utc;
      if (!sch || !rev) return 0;
      const diff = Math.round((new Date(rev) - new Date(sch)) / 60000);
      return diff > 0 ? diff : 0;
    };

    // 수속 권장 시간: 국내선 60분, 국제선 120분 (같은 국가 코드 기준)
    const depCountry = dep.airport?.countryCode || '';
    const arrCountry = arr.airport?.countryCode || '';
    const checkInMins = (depCountry && arrCountry && depCountry === arrCountry) ? 60 : 120;

    return {
      found:          true,
      airline:        f.airline?.name        || '',
      airlineIata:    f.airline?.iata         || '',
      status:         f.status               || '',
      // 출발
      depAirport:     dep.airport?.name      || dep.airport?.iata || '',
      depIata:        dep.airport?.iata      || '',
      depTerminal:    dep.terminal           || '',
      depGate:        dep.gate               || '',
      depCheckInDesk: dep.checkInDesk        || '',
      depTime:        extractTime(dep),
      depDelay:       calcDelay(dep),
      // 도착
      arrAirport:     arr.airport?.name      || arr.airport?.iata || '',
      arrIata:        arr.airport?.iata      || '',
      arrTerminal:    arr.terminal           || '',
      arrGate:        arr.gate               || '',
      arrTime:        extractTime(arr),
      arrDelay:       calcDelay(arr),
      // 수속
      checkInMins,
    };
  } catch (e) {
    console.error('lookupFlight error:', e);
    return { found: false };
  }
});

// ──────────────────────────────────────────────
// 항공편 지연 감지 및 일정 자동 업데이트 (30분마다)
// ──────────────────────────────────────────────
exports.checkFlightDelays = onSchedule(
  { schedule: 'every 30 minutes', region: 'asia-northeast3', timeZone: 'Asia/Seoul',
    secrets: ['RAPIDAPI_KEY'] },
  async () => {
    const KEY = process.env.RAPIDAPI_KEY;
    if (!KEY) return;

    const db    = admin.firestore();
    const today = todayKST();

    const schedSnap = await db.collection('schedules')
      .where('date', '==', today)
      .where('flightNumber', '!=', '')
      .get();

    for (const schedDoc of schedSnap.docs) {
      const schedule = { id: schedDoc.id, ...schedDoc.data() };
      if (!schedule.flightNumber) continue;

      try {
        const fn  = schedule.flightNumber.toUpperCase().replace(/\s/g, '');
        const url = `https://aerodatabox.p.rapidapi.com/flights/Number/${encodeURIComponent(fn)}`;

        const res  = await fetch(url, {
          headers: {
            'X-RapidAPI-Key':  KEY,
            'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
          },
        });
        const data = await res.json();
        if (!data || !Array.isArray(data) || !data.length) continue;

        const f   = data[0];
        const dep = f.departure || {};
        const arr = f.arrival   || {};

        const extractTime = (timeObj) => {
          const local = timeObj?.revisedTime?.local || timeObj?.scheduledTime?.local;
          if (!local) return null;
          const match = local.match(/(\d{2}:\d{2})/);
          return match ? match[1] : null;
        };

        const calcDelay = (timeObj) => {
          const sch = timeObj?.scheduledTime?.utc;
          const rev = timeObj?.revisedTime?.utc;
          if (!sch || !rev) return 0;
          const diff = Math.round((new Date(rev) - new Date(sch)) / 60000);
          return diff > 0 ? diff : 0;
        };

        const depDelay  = calcDelay(dep);
        const prevDelay = schedule.flightDelay || 0;
        if (depDelay === prevDelay) continue;

        const newDepTime = extractTime(dep);
        const newArrTime = extractTime(arr);

        const update = {
          flightDelay:  depDelay,
          flightStatus: f.status || '',
        };
        if (newDepTime) {
          update.time   = newDepTime;
          update.hour   = newDepTime.split(':')[0];
          update.minute = newDepTime.split(':')[1];
        }
        if (newArrTime) {
          update.endTime    = newArrTime;
          update.endHour    = newArrTime.split(':')[0];
          update.endMinute  = newArrTime.split(':')[1];
          update.useEndTime = true;
        }
        await schedDoc.ref.update(update);

        const tripSnap = await db.collection('trips').doc(schedule.tripId).get();
        if (!tripSnap.exists) continue;

        const delayH   = Math.floor(depDelay / 60);
        const delayM   = depDelay % 60;
        const delayStr = delayH > 0 ? `${delayH}시간 ${delayM}분` : `${delayM}분`;
        const body     = depDelay > 0
          ? `✈️ ${schedule.flightNumber} 편이 ${delayStr} 지연되었어요. 일정이 자동으로 업데이트됐습니다.`
          : `✅ ${schedule.flightNumber} 편 지연이 해소되어 정상 운항 예정입니다.`;

        await sendToMembers(db, tripSnap.data().members || [], {
          title: '항공편 상태 변경',
          body,
          data: { action: 'open_trip', tripId: schedule.tripId },
        });

      } catch (e) {
        console.error('checkFlightDelays error:', schedule.flightNumber, e);
      }
    }
  }
);

// ──────────────────────────────────────────────
// Google Places 장소 검색 (Text Search API)
// ──────────────────────────────────────────────
const PLACE_TYPE_KO = {
  airport: '공항', restaurant: '음식점', lodging: '숙소',
  tourist_attraction: '관광지', museum: '박물관', park: '공원',
  amusement_park: '놀이공원', shopping_mall: '쇼핑몰', store: '상점',
  cafe: '카페', bar: '바', bakery: '베이커리',
  transit_station: '교통', train_station: '기차역', bus_station: '버스',
  subway_station: '지하철', hospital: '병원', pharmacy: '약국',
  bank: '은행', atm: 'ATM', gas_station: '주유소', parking: '주차장',
  hotel: '호텔', spa: '스파', gym: '헬스장',
  art_gallery: '갤러리', church: '교회', temple: '사원',
  natural_feature: '자연', stadium: '경기장', university: '대학교',
};

exports.googlePlaceSearch = onCall({ secrets: ['GOOGLE_MAPS_API_KEY'] }, async (request) => {
  const { query } = request.data;
  if (!query || query.trim().length < 2) return { places: [] };

  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_MAPS_API_KEY) throw new HttpsError('internal', '서버 설정 오류');

  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json`
      + `?query=${encodeURIComponent(query.trim())}`
      + `&language=ko`
      + `&key=${GOOGLE_MAPS_API_KEY}`;

    const res  = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('Google Places API error:', data.status, data.error_message);
      return { places: [] };
    }

    return {
      places: (data.results || []).slice(0, 7).map(p => ({
        name:     p.name,
        address:  p.formatted_address || '',
        category: (p.types || []).map(t => PLACE_TYPE_KO[t]).find(Boolean) || '',
        x:        String(p.geometry?.location?.lng ?? ''),
        y:        String(p.geometry?.location?.lat ?? ''),
        placeId:  p.place_id || '',
      })),
    };
  } catch (e) {
    console.error('googlePlaceSearch error:', e);
    return { places: [] };
  }
});

// ──────────────────────────────────────────────
// 이메일 인증 코드 발송 (purpose: 'signup' | 'reset')
// ──────────────────────────────────────────────
exports.sendEmailCode = onCall(
  { secrets: ['SENDGRID_API_KEY'] },
  async (request) => {
    const { email, purpose } = request.data;
    if (!email || !purpose) throw new HttpsError('invalid-argument', '이메일과 목적이 필요합니다.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new HttpsError('invalid-argument', '올바른 이메일 형식이 아닙니다.');

    try {
      const existing = await admin.auth().getUserByEmail(email);
      if (purpose === 'signup')
        throw new HttpsError('already-exists', '이미 사용 중인 이메일입니다.');
    } catch (e) {
      if (e.code === 'already-exists') throw e;
      if (e.code !== 'auth/user-not-found' && purpose === 'reset')
        throw new HttpsError('not-found', '등록되지 않은 이메일입니다.');
    }

    // rate limit: 1분에 1회
    const db = admin.firestore();
    const docRef = db.collection('verificationCodes').doc(`email_${email}`);
    const existing2 = await docRef.get();
    if (existing2.exists) {
      const created = existing2.data()?.createdAt?.toDate();
      if (created && Date.now() - created.getTime() < 60000)
        throw new HttpsError('resource-exhausted', '1분 후 다시 요청해주세요.');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await docRef.set({
      type: 'email', target: email, code, purpose,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const subject = purpose === 'signup' ? '[PINLOGER] 이메일 인증 코드' : '[PINLOGER] 비밀번호 재설정 코드';
    await sgMail.send({
      from: { email: 'noreply@pinloger.web.app', name: 'PINLOGER' },
      replyTo: 'rhino2327@gmail.com',
      to: email,
      subject,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1a1a2e;color:#fff;padding:32px;border-radius:12px"><h2 style="color:#e94560">PINLOGER</h2><p style="color:#aaa">아래 6자리 코드를 앱에 입력해주세요. 10분 내에 사용하세요.</p><div style="background:#16213e;border-radius:12px;padding:24px;text-align:center;margin:20px 0;border:1px solid #0f3460"><span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#e94560">${code}</span></div><p style="color:#666;font-size:13px">본인이 요청하지 않은 경우 무시하세요.</p></div>`,
    });

    return { success: true };
  }
);

// ──────────────────────────────────────────────
// 이메일 코드 확인
// ──────────────────────────────────────────────
exports.verifyEmailCode = onCall({}, async (request) => {
  const { email, code } = request.data;
  if (!email || !code) throw new HttpsError('invalid-argument', '이메일과 코드가 필요합니다.');

  const db = admin.firestore();
  const docRef = db.collection('verificationCodes').doc(`email_${email}`);
  const snap = await docRef.get();

  if (!snap.exists) throw new HttpsError('not-found', '인증 코드를 찾을 수 없어요. 다시 요청해주세요.');
  const data = snap.data();
  if (data.used) throw new HttpsError('failed-precondition', '이미 사용된 코드입니다. 다시 요청해주세요.');
  if (data.expiresAt.toDate() < new Date()) throw new HttpsError('deadline-exceeded', '코드가 만료됐어요. 다시 요청해주세요.');
  if (data.code !== code.trim()) throw new HttpsError('unauthenticated', '인증 코드가 올바르지 않아요.');

  await docRef.update({ used: true });
  return { success: true, purpose: data.purpose };
});

// ──────────────────────────────────────────────
// 코드 인증 후 비밀번호 재설정 (Admin)
// ──────────────────────────────────────────────
exports.resetPasswordWithCode = onCall({}, async (request) => {
  const { target, type, code, newPassword } = request.data;
  if (!target || !type || !code || !newPassword)
    throw new HttpsError('invalid-argument', '모든 항목이 필요합니다.');
  if (newPassword.length < 6)
    throw new HttpsError('invalid-argument', '비밀번호는 6자 이상이어야 합니다.');

  const db = admin.firestore();
  const docKey = `email_${target}`;
  const snap = await db.collection('verificationCodes').doc(docKey).get();

  if (!snap.exists) throw new HttpsError('not-found', '인증 코드를 찾을 수 없어요.');
  const data = snap.data();
  if (data.used) throw new HttpsError('failed-precondition', '이미 사용된 코드입니다.');
  if (data.expiresAt.toDate() < new Date()) throw new HttpsError('deadline-exceeded', '코드가 만료됐어요.');
  if (data.code !== code.trim()) throw new HttpsError('unauthenticated', '인증 코드가 올바르지 않아요.');

  const userRecord = await admin.auth().getUserByEmail(target).catch(() => null);
  if (!userRecord) throw new HttpsError('not-found', '등록된 계정을 찾을 수 없어요.');
  const uid = userRecord.uid;

  await admin.auth().updateUser(uid, { password: newPassword });
  await db.collection('verificationCodes').doc(docKey).update({ used: true });
  return { success: true };
});

// ──────────────────────────────────────────────
// 닉네임/전화번호 중복 체크
// ──────────────────────────────────────────────
exports.checkAvailability = onCall({}, async (request) => {
  const { type, value } = request.data;
  if (!type || !value) throw new HttpsError('invalid-argument', 'type과 value가 필요합니다.');

  const db = admin.firestore();
  const uid = request.auth?.uid;

  if (type === 'nickname') {
    const snap = await db.collection('users').where('nickname', '==', value.trim()).limit(2).get();
    const others = snap.docs.filter(d => d.id !== uid);
    return { available: others.length === 0 };
  }

  if (type === 'phone') {
    let normalized = value.trim().replace(/[\s\-()]/g, '');
    if (normalized.startsWith('0')) normalized = '+82' + normalized.slice(1);
    else if (!normalized.startsWith('+')) normalized = '+82' + normalized;
    const snap = await db.collection('users').where('phone', '==', normalized).limit(2).get();
    const others = snap.docs.filter(d => d.id !== uid);
    return { available: others.length === 0 };
  }

  throw new HttpsError('invalid-argument', '지원하지 않는 type입니다.');
});

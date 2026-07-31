/**
 * Standalone Blackcheck platform that mirrors the Bamcheat number-search workflow.
 */
const API_PREFIX = window.BLACKCHECK_API_PREFIX || '/api';
let accessCode = sessionStorage.getItem('blackcheck_access_code') || '';

const REGION_DISTRICT_MAP = {
  서울: ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'],
  경기: ['가평군', '고양시', '과천시', '광명시', '광주시', '구리시', '군포시', '김포시', '남양주시', '동두천시', '부천시', '성남시', '수원시', '시흥시', '안산시', '안성시', '안양시', '양주시', '양평군', '여주시', '연천군', '오산시', '용인시', '의왕시', '의정부시', '이천시', '파주시', '평택시', '포천시', '하남시', '화성시'],
  인천: ['강화군', '계양구', '남동구', '동구', '미추홀구', '부평구', '서구', '연수구', '옹진군', '중구'],
  부산: ['강서구', '금정구', '기장군', '남구', '동구', '동래구', '부산진구', '북구', '사상구', '사하구', '서구', '수영구', '연제구', '영도구', '중구', '해운대구'],
  대구: ['남구', '달서구', '달성군', '동구', '북구', '서구', '수성구', '중구'],
  광주: ['광산구', '남구', '동구', '북구', '서구'],
  대전: ['대덕구', '동구', '서구', '유성구', '중구'],
  울산: ['남구', '동구', '북구', '울주군', '중구'],
  강원: ['강릉시', '고성군', '동해시', '삼척시', '속초시', '양구군', '양양군', '영월군', '원주시', '인제군', '정선군', '철원군', '춘천시', '태백시', '평창군', '홍천군', '화천군', '횡성군'],
  경남: ['거제시', '거창군', '고성군', '김해시', '남해군', '밀양시', '사천시', '산청군', '양산시', '의령군', '진주시', '창녕군', '창원시', '통영시', '하동군', '함안군', '함양군', '합천군'],
  경북: ['경산시', '경주시', '고령군', '구미시', '군위군', '김천시', '문경시', '봉화군', '상주시', '성주군', '안동시', '영덕군', '영양군', '영주시', '영천시', '예천군', '울릉군', '울진군', '의성군', '청도군', '청송군', '칠곡군', '포항시'],
  전남: ['강진군', '고흥군', '곡성군', '광양시', '구례군', '나주시', '담양군', '목포시', '무안군', '보성군', '순천시', '신안군', '여수시', '영광군', '영암군', '완도군', '장성군', '장흥군', '진도군', '함평군', '해남군', '화순군'],
  전북: ['고창군', '군산시', '김제시', '남원시', '무주군', '부안군', '순창군', '완주군', '익산시', '임실군', '장수군', '전주시', '정읍시', '진안군'],
  충남: ['계룡시', '공주시', '금산군', '논산시', '당진시', '보령시', '부여군', '서산시', '서천군', '아산시', '예산군', '천안시', '청양군', '태안군', '홍성군'],
  충북: ['괴산군', '단양군', '보은군', '영동군', '옥천군', '음성군', '제천시', '증평군', '진천군', '청원군', '청주시', '충주시'],
  세종: ['세종시'],
  제주: ['서귀포시', '제주시']
};

const $ = (id) => document.getElementById(id);
function normalizePhone(value) { return String(value || '').replace(/[^0-9]/g, '').slice(0, 11).trim(); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`; }
function formatPhone(value) { const phone = normalizePhone(value); if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`; if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`; return phone; }
function maskPart(part) { if (!part) return part; const index = Math.floor(Math.random() * part.length); return `${part.slice(0, index)}*${part.slice(index + 1)}`; }
function maskPhone(value) { const parts = formatPhone(value).split('-'); if (parts.length >= 3) { parts[parts.length - 2] = maskPart(parts[parts.length - 2]); parts[parts.length - 1] = maskPart(parts[parts.length - 1]); return parts.join('-'); } return formatPhone(value); }
function areaText(item) { const region = String(item?.region || '').trim(); const district = String(item?.district || '').trim(); if (region && district) return `${region} ${district}`; if (region) return region; return String(item?.comment || '').match(/^\s*\[([^\]\n]{1,12})\]/)?.[1]?.trim() || ''; }
function cleanComment(comment) { return String(comment || '').replace(/^\s*\[[^\]\n]{1,12}\]\s*/, ''); }
function withAccess(data = {}) { return { ...data, accessCode }; }

async function request(method, endpoint, data = {}) {
  const url = new URL(`${API_PREFIX}${endpoint}`, window.location.origin);
  const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (method === 'GET') Object.entries(data).forEach(([key, value]) => value && url.searchParams.set(key, value));
  else options.body = JSON.stringify(data);
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  return payload;
}

function updateAccessView() {
  $('access-card')?.classList.toggle('hidden', Boolean(accessCode));
  $('content-card')?.classList.toggle('hidden', !accessCode);
}

function updateDistricts() { const region = $('comment-region')?.value || ''; const districts = REGION_DISTRICT_MAP[region] || []; $('comment-district').innerHTML = '<option value="">구/군 선택</option>'; districts.forEach((district) => $('comment-district').append(new Option(district, district))); $('comment-district').disabled = !districts.length; }

function renderOverview(comments, phone) {
  const overview = $('overview');
  overview.innerHTML = '';
  overview.classList.toggle('hidden', !phone);
  if (!phone) return;
  const regions = [...new Set(comments.map(areaText).filter(Boolean))];
  const latestDate = comments[0]?.createdAt ? formatDate(comments[0].createdAt) : '';
  overview.innerHTML = `<div class="phone">📞 ${maskPhone(phone)}</div><div class="overview-grid"><div><span>📍 활동지역</span><strong>${regions.length ? regions.slice(0, 6).join(' / ') : '등록된 활동지역 없음'}</strong></div><div><span>📝 제보 요약</span><strong>${comments.length ? `댓글 ${comments.length}개${latestDate ? ` · 최근 제보 ${latestDate}` : ''}` : '등록된 댓글이 없습니다.'}</strong></div></div>`;
}

function renderComments(comments, phone) {
  renderOverview(comments, phone);
  $('result-heading')?.classList.toggle('hidden', !phone);
  $('comment-heading')?.classList.toggle('hidden', !comments.length);
  $('comment-list').innerHTML = '';
  $('comment-phone').value = phone || '';
  $('comment-form').classList.toggle('hidden', !phone);
  if (!comments.length) { $('empty-message').textContent = phone ? '검색된 코멘트가 없습니다. 아래에서 이 번호에 대한 정보를 남겨주세요.' : '번호를 검색하면 코멘트가 표시됩니다.'; return; }
  $('empty-message').textContent = '';
  comments.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'comment-item';
    const recommendationButton = item.readOnly ? '' : `<button class="comment-recommend-btn${item.isRecommendedByMe ? ' active' : ''}" type="button" data-comment-id="${item.id}">👍 ${Number(item.recommendationCount || 0)}</button>`;
    li.innerHTML = `<div class="comment-header"><div class="comment-meta">${areaText(item) ? `[${areaText(item)}] ` : ''}${formatDate(item.createdAt)}</div></div><div class="comment-content"><p class="comment-body"></p>${recommendationButton}</div>`;
    li.querySelector('.comment-body').textContent = cleanComment(item.comment);
    $('comment-list').append(li);
  });
}

async function submitAccessCode(event) {
  event.preventDefault();
  const code = $('access-code-input').value.trim();
  if (!code) return void ($('access-status').textContent = '입장코드를 입력해주세요.');
  try {
    await request('POST', '/blackcheck/access', { accessCode: code });
    accessCode = code;
    sessionStorage.setItem('blackcheck_access_code', accessCode);
    $('access-status').textContent = '';
    updateAccessView();
  } catch (error) {
    $('access-status').textContent = error.message || '입장코드가 올바르지 않습니다.';
  }
}

async function searchComments(event) {
  event?.preventDefault();
  const phone = normalizePhone($('phone-input')?.value);
  if (!phone || phone.length < 7 || phone.length > 11) { $('main-status').textContent = '검색할 번호를 7~11자리 숫자로 입력해주세요.'; renderComments([], ''); return; }
  try { $('main-status').textContent = '검색 중입니다...'; const response = await request('GET', '/bamcheat/comments', withAccess({ phoneNumber: phone })); renderComments(response.comments || [], response.phoneNumber || phone); $('main-status').textContent = response.hasComments ? '검색 결과를 확인하세요.' : '정보가 없습니다. 코멘트를 남길 수 있습니다.'; }
  catch (error) { $('main-status').textContent = error.message; renderComments([], ''); }
}

async function submitComment(event) {
  event.preventDefault();
  const region = $('comment-region').value;
  const district = $('comment-district').value;
  const comment = $('comment-input').value.trim();
  if (!REGION_DISTRICT_MAP[region]) return void ($('main-status').textContent = '활동 시/도를 선택해주세요.');
  if (!REGION_DISTRICT_MAP[region].includes(district)) return void ($('main-status').textContent = '활동 구/군을 선택해주세요.');
  if (!comment) return void ($('main-status').textContent = '코멘트를 입력해주세요.');
  try { await request('POST', '/bamcheat/comments', withAccess({ phoneNumber: normalizePhone($('comment-phone').value), region, district, comment })); $('comment-input').value = ''; $('main-status').textContent = '코멘트가 등록되었습니다.'; await searchComments(); }
  catch (error) { $('main-status').textContent = error.message; }
}

async function handleCommentClick(event) {
  const recommend = event.target.closest('[data-comment-id]');
  if (!recommend) return;
  try { const response = await request('POST', `/bamcheat/comments/${encodeURIComponent(recommend.dataset.commentId)}/recommend`, withAccess({})); recommend.textContent = `👍 ${Number(response.recommendationCount || 0)}`; recommend.classList.toggle('active', Boolean(response.isRecommendedByMe)); }
  catch (error) { $('main-status').textContent = error.message; }
}

async function restoreAccessCode() {
  if (!accessCode) return;

  try {
    await request('POST', '/blackcheck/access', { accessCode });
  } catch (_error) {
    accessCode = '';
    sessionStorage.removeItem('blackcheck_access_code');
    $('access-status').textContent = '저장된 입장코드가 만료되었거나 비활성화되었습니다. 다시 입력해주세요.';
  }
}

async function init() {
  Object.keys(REGION_DISTRICT_MAP).forEach((region) => $('comment-region').append(new Option(region, region)));
  $('comment-region').value = '서울';
  updateDistricts();
  $('comment-district').value = '강남구';
  $('access-form').addEventListener('submit', submitAccessCode);
  $('reset-code-btn').addEventListener('click', () => { accessCode = ''; sessionStorage.removeItem('blackcheck_access_code'); renderComments([], ''); updateAccessView(); });
  $('phone-input').addEventListener('input', (event) => { event.target.value = normalizePhone(event.target.value); });
  $('search-form').addEventListener('submit', searchComments);
  $('comment-region').addEventListener('change', updateDistricts);
  $('comment-form').addEventListener('submit', submitComment);
  $('comment-list').addEventListener('click', handleCommentClick);
  await restoreAccessCode();
  updateAccessView();
  renderComments([], '');
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();

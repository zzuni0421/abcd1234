(() => {
  const cfg = window.URIBAN_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const toastEl = $("#toast");
  let toastTimer;
  let currentUser = null;
  let currentProfile = null;
  let currentClassroom = null;
  let activeFilter = "all";
  let postsCache = [];

  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR_PROJECT")
    && cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE");
  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY)
    : null;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }
  function setBusy(form, busy) {
    const button = $("button[type=submit]", form);
    if (button) { button.disabled = busy; button.style.opacity = busy ? ".65" : "1"; }
  }
  function safeError(error) {
    const msg = error?.message || "알 수 없는 오류가 발생했어요.";
    if (/Invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호를 확인해 주세요.";
    if (/User already registered/i.test(msg)) return "이미 가입된 이메일이에요. 로그인해 주세요.";
    if (/Invalid invite code/i.test(msg)) return "초대 코드가 올바르지 않아요.";
    if (/not a member|classroom/i.test(msg)) return "아직 학급에 가입하지 않았어요. 초대 코드를 확인해 주세요.";
    return msg;
  }
  function showSignedOut() {
    $("#auth-panel").classList.remove("hidden");
    $("#app-panel").classList.add("hidden");
    $("#logout-btn").classList.add("hidden");
    $("#session-label").textContent = "로그인 전";
  }
  function showSignedIn() {
    $("#auth-panel").classList.add("hidden");
    $("#app-panel").classList.remove("hidden");
    $("#logout-btn").classList.remove("hidden");
    $("#session-label").textContent = currentProfile?.nickname || "로그인됨";
    $("#welcome-title").textContent = `안녕, ${currentProfile?.nickname || "친구"}! 🌷`;
    $("#profile-nickname").value = currentProfile?.nickname || "";
    $("#role-label").textContent = currentProfile?.role === "admin" ? "🛡️ 관리자" : "🌱 학생";
    $("#admin-tools").classList.toggle("hidden", currentProfile?.role !== "admin");
  }
  async function loadProfile() {
    const { data, error } = await sb.from("profiles").select("id,nickname,role,classroom_id").eq("id", currentUser.id).maybeSingle();
    if (error) throw error;
    currentProfile = data;
    if (!currentProfile?.classroom_id) {
      currentClassroom = null;
      showSignedOut();
      toast("학급에 가입되지 않은 계정이에요. 가입할 때 초대 코드를 입력했는지 확인해 주세요.");
      await sb.auth.signOut();
      currentUser = null;
      return false;
    }
    const { data: classroom, error: cError } = await sb.from("classrooms").select("id,name").eq("id", currentProfile.classroom_id).single();
    if (cError) throw cError;
    currentClassroom = classroom;
    showSignedIn();
    await loadPosts();
    return true;
  }

  async function joinClass(inviteCode) {
    const { error } = await sb.rpc("join_class_with_code", { p_invite_code: inviteCode.trim() });
    if (error) throw error;
  }

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!sb) return toast("먼저 config.js에 Supabase URL과 publishable key를 설정해 주세요.");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(form, true);
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: values.email.trim(), password: values.password });
      if (error) throw error;
      currentUser = data.user;
      await loadProfile();
      toast("로그인했어요. 환영해요! ✨");
    } catch (error) { toast(safeError(error)); }
    finally { setBusy(form, false); }
  });

  $("#signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!sb) return toast("먼저 config.js에 Supabase URL과 publishable key를 설정해 주세요.");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (values.password.length < 8) return toast("비밀번호는 8자 이상으로 설정해 주세요.");
    setBusy(form, true);
    let createdUser = null;
    try {
      const { data, error } = await sb.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: { data: { nickname: values.nickname.trim() } }
      });
      if (error) throw error;
      createdUser = data.user;
      if (!createdUser) throw new Error("계정이 생성되지 않았어요. Supabase Auth 설정을 확인해 주세요.");
      if (!data.session) {
        toast("이메일 인증이 켜져 있어요. 메일 인증 후 로그인하고, 초대 코드 가입 절차를 진행해야 해요. MVP 테스트는 Supabase Auth에서 이메일 확인을 끄거나 인증 흐름을 별도로 구현하세요.");
        return;
      }
      currentUser = createdUser;
      await joinClass(values.invite_code);
      await loadProfile();
      form.reset();
      toast("가입 완료! 우리 반에 온 걸 환영해요 🌷");
    } catch (error) {
      toast(safeError(error));
      if (createdUser && !currentUser) toast("계정은 만들어졌을 수 있어요. 초대 코드 문제라면 관리자에게 계정 정리 또는 코드 확인을 요청해 주세요.");
    } finally { setBusy(form, false); }
  });

  $("#logout-btn").addEventListener("click", async () => {
    if (!sb) return;
    const { error } = await sb.auth.signOut();
    if (error) return toast(safeError(error));
    currentUser = currentProfile = currentClassroom = null;
    showSignedOut();
    toast("로그아웃했어요.");
  });

  $("#save-profile-btn").addEventListener("click", async () => {
    if (!sb || !currentUser) return;
    const nickname = $("#profile-nickname").value.trim();
    if (nickname.length < 2 || nickname.length > 20) return toast("닉네임은 2~20자로 입력해 주세요.");
    const { error } = await sb.from("profiles").update({ nickname }).eq("id", currentUser.id);
    if (error) return toast(safeError(error));
    currentProfile.nickname = nickname;
    showSignedIn();
    toast("프로필을 저장했어요.");
  });

  $("#post-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!sb || !currentUser || !currentClassroom) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(form, true);
    try {
      const { error } = await sb.from("posts").insert({
        classroom_id: currentClassroom.id,
        author_id: currentUser.id,
        category: values.category,
        title: values.title.trim(),
        body: values.body.trim(),
        is_notice: false
      });
      if (error) throw error;
      form.reset();
      await loadPosts();
      toast("게시글을 등록했어요! ✨");
    } catch (error) { toast(safeError(error)); }
    finally { setBusy(form, false); }
  });

  $("#new-notice-btn").addEventListener("click", async () => {
    if (currentProfile?.role !== "admin") return toast("관리자만 공지를 작성할 수 있어요.");
    const title = prompt("공지 제목을 입력해 주세요.");
    if (!title?.trim()) return;
    const body = prompt("공지 내용을 입력해 주세요.");
    if (!body?.trim()) return;
    const { error } = await sb.from("posts").insert({
      classroom_id: currentClassroom.id, author_id: currentUser.id,
      category: "notice", title: title.trim(), body: body.trim(), is_notice: true
    });
    if (error) return toast(safeError(error));
    await loadPosts();
    toast("공지사항을 등록했어요 📌");
  });

  $("#refresh-btn").addEventListener("click", loadPosts);
  $$(".nav-item").forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    $$(".nav-item").forEach(b => b.classList.toggle("active", b === button));
    $("#feed-title").textContent = ({all:"우리 반 이야기",notice:"📌 공지사항",free:"💬 자유게시판",study:"📚 학습 자료실"})[activeFilter];
    renderPosts();
  }));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
  function canDelete(authorId) {
    return currentProfile?.role === "admin" || authorId === currentUser?.id;
  }

  async function loadPosts() {
    if (!sb || !currentUser || !currentClassroom) return;
    $("#feed").replaceChildren(el("div", "empty-state", "게시글을 불러오는 중..."));
    const { data, error } = await sb.from("posts")
      .select("id,classroom_id,author_id,category,title,body,is_notice,created_at,profiles!posts_author_id_fkey(nickname,role),comments(id,post_id,parent_id,author_id,body,created_at,profiles!comments_author_id_fkey(nickname,role))")
      .eq("classroom_id", currentClassroom.id)
      .order("is_notice", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      $("#feed").replaceChildren(el("div", "empty-state", "게시글을 불러오지 못했어요: " + error.message));
      return;
    }
    postsCache = data || [];
    renderPosts();
  }

  function renderPosts() {
    const feed = $("#feed");
    feed.replaceChildren();
    const filtered = postsCache.filter(post => activeFilter === "all"
      || (activeFilter === "notice" ? post.is_notice || post.category === "notice" : post.category === activeFilter));
    if (!filtered.length) { feed.append(el("div", "empty-state", "아직 게시글이 없어요. 첫 글을 남겨 볼까요? 🌷")); return; }
    filtered.forEach(post => feed.append(renderPost(post)));
  }

  function renderPost(post) {
    const card = el("article", "post-card");
    const meta = el("div", "post-meta");
    meta.append(el("span", "category-tag" + (post.is_notice ? " notice" : ""), post.is_notice ? "📌 공지" : ({free:"자유게시판",study:"학습 자료실",notice:"공지사항"})[post.category] || "게시글"));
    meta.append(el("span", "", post.profiles?.nickname || "알 수 없는 사용자"));
    if (post.profiles?.role === "admin") meta.append(el("span", "pill", "선생님/관리자"));
    meta.append(el("span", "", "· " + formatDate(post.created_at)));
    card.append(meta, el("h3", "", post.title), el("div", "post-body", post.body));
    const actions = el("div", "post-actions");
    const commentToggle = el("button", "small-button", `💬 댓글 ${post.comments?.length || 0}`);
    commentToggle.type = "button";
    commentToggle.addEventListener("click", () => commentsSection.classList.toggle("hidden"));
    actions.append(commentToggle);
    if (canDelete(post.author_id)) {
      const del = el("button", "small-button danger", "삭제");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm("이 게시글을 삭제할까요?")) return;
        const { error } = await sb.from("posts").delete().eq("id", post.id);
        if (error) return toast(safeError(error));
        await loadPosts(); toast("게시글을 삭제했어요.");
      });
      actions.append(del);
    }
    card.append(actions);

    const commentsSection = el("section", "comments hidden");
    const topLevel = (post.comments || []).filter(c => !c.parent_id);
    topLevel.forEach(comment => {
      commentsSection.append(renderComment(comment, post.comments || [], post.id, 0));
    });
    const commentForm = el("form", "comment-form");
    const input = el("input");
    input.name = "body"; input.required = true; input.maxLength = 2000; input.placeholder = "따뜻한 댓글을 남겨 주세요.";
    const submit = el("button", "small-button", "댓글 등록"); submit.type = "submit";
    commentForm.append(input, submit);
    commentForm.addEventListener("submit", async e => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      const { error } = await sb.from("comments").insert({ post_id: post.id, author_id: currentUser.id, parent_id: null, body });
      if (error) return toast(safeError(error));
      await loadPosts(); toast("댓글을 등록했어요.");
    });
    commentsSection.append(commentForm);
    card.append(commentsSection);
    return card;
  }

  function renderComment(comment, allComments, postId, depth) {
    const wrapper = el("div", depth ? "comment reply-list" : "comment");
    const head = el("div", "comment-head");
    head.append(el("span", "", comment.profiles?.nickname || "친구"));
    if (comment.profiles?.role === "admin") head.append(el("span", "pill", "관리자"));
    head.append(el("span", "muted", "· " + formatDate(comment.created_at)));
    wrapper.append(head, el("div", "comment-body", comment.body));
    const controls = el("div", "post-actions");
    const replyButton = el("button", "small-button", "↳ 답글");
    replyButton.type = "button";
    replyButton.addEventListener("click", () => {
      if ($(".comment-form", wrapper)) return;
      const form = el("form", "comment-form");
      const input = el("input"); input.required = true; input.maxLength = 2000; input.placeholder = `${comment.profiles?.nickname || "친구"}에게 답글`;
      const send = el("button", "small-button", "등록"); send.type = "submit";
      form.append(input, send);
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        const { error } = await sb.from("comments").insert({ post_id: postId, author_id: currentUser.id, parent_id: comment.id, body });
        if (error) return toast(safeError(error));
        await loadPosts(); toast("답글을 등록했어요.");
      });
      wrapper.append(form);
      input.focus();
    });
    controls.append(replyButton);
    if (canDelete(comment.author_id)) {
      const del = el("button", "small-button danger", "삭제"); del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm("댓글을 삭제할까요?")) return;
        const { error } = await sb.from("comments").delete().eq("id", comment.id);
        if (error) return toast(safeError(error));
        await loadPosts(); toast("댓글을 삭제했어요.");
      });
      controls.append(del);
    }
    wrapper.append(controls);
    const replies = allComments.filter(c => c.parent_id === comment.id);
    replies.forEach(reply => wrapper.append(renderComment(reply, allComments, postId, depth + 1)));
    return wrapper;
  }

  async function init() {
    if (!sb) {
      showSignedOut();
      toast("config.js에 Supabase 설정을 입력하면 시작할 수 있어요.");
      return;
    }
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      try { await loadProfile(); } catch (error) { toast(safeError(error)); }
    } else showSignedOut();
    sb.auth.onAuthStateChange(async (_event, sessionNow) => {
      if (sessionNow?.user && sessionNow.user.id !== currentUser?.id) {
        currentUser = sessionNow.user;
        try { await loadProfile(); } catch (error) { toast(safeError(error)); }
      } else if (!sessionNow) {
        currentUser = currentProfile = currentClassroom = null;
        showSignedOut();
      }
    });
  }
  init();
})();

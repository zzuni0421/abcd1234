(() => {
  "use strict";

  const cfg = window.URIBAN_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const toastEl = $("#toast");

  let toastTimer;
  let currentUser = null;
  let currentProfile = null;
  let currentClassroom = null;
  let activeFilter = "all";
  let postsCache = [];

  const configured =
    cfg.SUPABASE_URL &&
    !cfg.SUPABASE_URL.includes("YOUR_PROJECT") &&
    cfg.SUPABASE_PUBLISHABLE_KEY &&
    !cfg.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE");

  const sb = configured && window.supabase
    ? window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_PUBLISHABLE_KEY
      )
    : null;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 3200);
  }

  function setBusy(form, busy) {
    const button = $("button[type=submit]", form);

    if (button) {
      button.disabled = busy;
      button.style.opacity = busy ? ".65" : "1";
    }
  }

  function safeError(error) {
    const message = error?.message || "알 수 없는 오류가 발생했어요.";

    if (/Invalid login credentials/i.test(message)) {
      return "이메일 또는 비밀번호를 확인해 주세요.";
    }

    if (/User already registered/i.test(message)) {
      return "이미 가입된 이메일이에요. 로그인해 주세요.";
    }

    if (/Invalid invite code/i.test(message)) {
      return "학급 가입 코드가 올바르지 않아요.";
    }

    if (/A valid real name is required/i.test(message)) {
      return "실명을 2~20자로 입력해 주세요.";
    }

    if (/Database error saving new user/i.test(message)) {
      return "가입에 실패했어요. 실명, 가입 코드와 Supabase 설정을 확인해 주세요.";
    }

    if (/not a member|classroom/i.test(message)) {
      return "학급 가입 정보를 확인해 주세요.";
    }

    return message;
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

    const name = currentProfile?.real_name || "이름 미설정";

    $("#session-label").textContent = name;
    $("#welcome-title").textContent = `안녕, ${name}! 🌷`;
    $("#profile-real-name").textContent = name;

    $("#role-label").textContent =
      currentProfile?.role === "admin" ? "🛡️ 관리자" : "🌱 학생";

    $("#admin-tools").classList.toggle(
      "hidden",
      currentProfile?.role !== "admin"
    );
  }

  async function loadProfile() {
    const { data, error } = await sb
      .from("profiles")
      .select("id,real_name,role,classroom_id")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) throw error;

    currentProfile = data;

    if (!currentProfile?.classroom_id) {
      currentClassroom = null;
      showSignedOut();
      await sb.auth.signOut();
      currentUser = null;

      toast("학급 가입 정보를 찾을 수 없어요. 관리자에게 문의해 주세요.");
      return false;
    }

    const { data: classroom, error: classroomError } = await sb
      .from("classrooms")
      .select("id,name")
      .eq("id", currentProfile.classroom_id)
      .single();

    if (classroomError) throw classroomError;

    currentClassroom = classroom;

    showSignedIn();
    await loadPosts();

    return true;
  }

  // 로그인
  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!sb) {
      return toast("config.js에 Supabase 설정을 입력해 주세요.");
    }

    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    setBusy(form, true);

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password
      });

      if (error) throw error;

      currentUser = data.user;

      const loaded = await loadProfile();

      if (loaded) {
        toast("로그인했어요. 환영해요! ✨");
      }
    } catch (error) {
      toast(safeError(error));
    } finally {
      setBusy(form, false);
    }
  });

  // 실명 + 이메일 + 비밀번호 + 학급 가입 코드 회원가입
  $("#signup-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!sb) {
      return toast("config.js에 Supabase 설정을 입력해 주세요.");
    }

    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    const realName = values.real_name.trim();
    const inviteCode = values.invite_code.trim();
    const email = values.email.trim();
    const password = values.password;

    if (realName.length < 2 || realName.length > 20) {
      return toast("실명은 2~20자로 입력해 주세요.");
    }

    if (password.length < 8) {
      return toast("비밀번호는 8자 이상으로 설정해 주세요.");
    }

    if (inviteCode.length < 6) {
      return toast("학급 가입 코드를 확인해 주세요.");
    }

    setBusy(form, true);

    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            real_name: realName,
            invite_code: inviteCode
          }
        }
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error("계정이 생성되지 않았어요.");
      }

      form.reset();

      if (!data.session) {
        toast("가입 요청이 완료됐어요. 이메일 인증 후 로그인해 주세요.");
        return;
      }

      currentUser = data.user;

      const loaded = await loadProfile();

      if (loaded) {
        toast("가입 완료! 우리 반에 온 걸 환영해요 🌷");
      }
    } catch (error) {
      toast(safeError(error));
    } finally {
      setBusy(form, false);
    }
  });

  // 로그아웃
  $("#logout-btn").addEventListener("click", async () => {
    if (!sb) return;

    const { error } = await sb.auth.signOut();

    if (error) {
      return toast(safeError(error));
    }

    currentUser = null;
    currentProfile = null;
    currentClassroom = null;
    postsCache = [];

    showSignedOut();
    toast("로그아웃했어요.");
  });

  // 게시글 작성
  $("#post-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!sb || !currentUser || !currentClassroom) {
      return toast("먼저 로그인해 주세요.");
    }

    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    const title = values.title.trim();
    const body = values.body.trim();

    if (!title || !body) {
      return toast("제목과 내용을 입력해 주세요.");
    }

    setBusy(form, true);

    try {
      const { error } = await sb.from("posts").insert({
        classroom_id: currentClassroom.id,
        author_id: currentUser.id,
        category: values.category,
        title,
        body,
        is_notice: false
      });

      if (error) throw error;

      form.reset();
      await loadPosts();

      toast("게시글을 등록했어요! ✨");
    } catch (error) {
      toast(safeError(error));
    } finally {
      setBusy(form, false);
    }
  });

  // 관리자 공지 작성
  $("#new-notice-btn").addEventListener("click", async () => {
    if (currentProfile?.role !== "admin") {
      return toast("관리자만 공지를 작성할 수 있어요.");
    }

    const title = prompt("공지 제목을 입력해 주세요.");
    if (!title?.trim()) return;

    const body = prompt("공지 내용을 입력해 주세요.");
    if (!body?.trim()) return;

    const { error } = await sb.from("posts").insert({
      classroom_id: currentClassroom.id,
      author_id: currentUser.id,
      category: "notice",
      title: title.trim(),
      body: body.trim(),
      is_notice: true
    });

    if (error) return toast(safeError(error));

    await loadPosts();
    toast("공지사항을 등록했어요 📌");
  });

  // 게시판 필터
  $("#refresh-btn").addEventListener("click", loadPosts);

  $$(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;

      $$(".nav-item").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      $("#feed-title").textContent = ({
        all: "우리 반 이야기",
        notice: "📌 공지사항",
        free: "💬 자유게시판",
        study: "📚 학습 자료실"
      })[activeFilter];

      renderPosts();
    });
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function canDelete(authorId) {
    return currentProfile?.role === "admin" ||
      authorId === currentUser?.id;
  }

  // 게시글 및 댓글 불러오기
  async function loadPosts() {
    if (!sb || !currentUser || !currentClassroom) return;

    $("#feed").replaceChildren(
      el("div", "empty-state", "게시글을 불러오는 중...")
    );

    const { data, error } = await sb
      .from("posts")
      .select(`
        id,
        classroom_id,
        author_id,
        category,
        title,
        body,
        is_notice,
        created_at,
        profiles!posts_author_id_fkey(real_name,role),
        comments(
          id,
          post_id,
          parent_id,
          author_id,
          body,
          created_at,
          profiles!comments_author_id_fkey(real_name,role)
        )
      `)
      .eq("classroom_id", currentClassroom.id)
      .order("is_notice", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      $("#feed").replaceChildren(
        el("div", "empty-state", "게시글을 불러오지 못했어요: " + error.message)
      );
      return;
    }

    postsCache = data || [];
    renderPosts();
  }

  function renderPosts() {
    const feed = $("#feed");
    feed.replaceChildren();

    const filtered = postsCache.filter(post => {
      if (activeFilter === "all") return true;

      if (activeFilter === "notice") {
        return post.is_notice || post.category === "notice";
      }

      return post.category === activeFilter;
    });

    if (!filtered.length) {
      feed.append(
        el("div", "empty-state", "아직 게시글이 없어요. 첫 글을 남겨 볼까요? 🌷")
      );
      return;
    }

    filtered.forEach(post => feed.append(renderPost(post)));
  }

  function renderPost(post) {
    const card = el("article", "post-card");
    const meta = el("div", "post-meta");

    const categoryName = post.is_notice
      ? "📌 공지"
      : ({
          free: "자유게시판",
          study: "학습 자료실",
          notice: "공지사항"
        })[post.category] || "게시글";

    meta.append(
      el(
        "span",
        "category-tag" + (post.is_notice ? " notice" : ""),
        categoryName
      )
    );

    meta.append(
      el("span", "", post.profiles?.real_name || "이름 미설정")
    );

    if (post.profiles?.role === "admin") {
      meta.append(el("span", "pill", "관리자"));
    }

    meta.append(el("span", "", "· " + formatDate(post.created_at)));

    card.append(
      meta,
      el("h3", "", post.title),
      el("div", "post-body", post.body)
    );

    const actions = el("div", "post-actions");
    const commentsSection = el("section", "comments hidden");

    const commentToggle = el(
      "button",
      "small-button",
      `💬 댓글 ${post.comments?.length || 0}`
    );

    commentToggle.type = "button";
    commentToggle.addEventListener("click", () => {
      commentsSection.classList.toggle("hidden");
    });

    actions.append(commentToggle);

    if (canDelete(post.author_id)) {
      const deleteButton = el("button", "small-button danger", "삭제");
      deleteButton.type = "button";

      deleteButton.addEventListener("click", async () => {
        if (!confirm("이 게시글을 삭제할까요?")) return;

        const { error } = await sb
          .from("posts")
          .delete()
          .eq("id", post.id);

        if (error) return toast(safeError(error));

        await loadPosts();
        toast("게시글을 삭제했어요.");
      });

      actions.append(deleteButton);
    }

    card.append(actions);

    const comments = post.comments || [];
    const topLevel = comments.filter(comment => !comment.parent_id);

    topLevel.forEach(comment => {
      commentsSection.append(
        renderComment(comment, comments, post.id, 0)
      );
    });

    const commentForm = el("form", "comment-form");
    const input = el("input");

    input.name = "body";
    input.required = true;
    input.maxLength = 2000;
    input.placeholder = "따뜻한 댓글을 남겨 주세요.";

    const submit = el("button", "small-button", "댓글 등록");
    submit.type = "submit";

    commentForm.append(input, submit);

    commentForm.addEventListener("submit", async event => {
      event.preventDefault();

      const body = input.value.trim();
      if (!body) return;

      const { error } = await sb.from("comments").insert({
        post_id: post.id,
        author_id: currentUser.id,
        parent_id: null,
        body
      });

      if (error) return toast(safeError(error));

      await loadPosts();
      toast("댓글을 등록했어요.");
    });

    commentsSection.append(commentForm);
    card.append(commentsSection);

    return card;
  }

  function renderComment(comment, allComments, postId, depth) {
    const wrapper = el(
      "div",
      depth ? "comment reply-list" : "comment"
    );

    const head = el("div", "comment-head");

    head.append(
      el("span", "", comment.profiles?.real_name || "친구")
    );

    if (comment.profiles?.role === "admin") {
      head.append(el("span", "pill", "관리자"));
    }

    head.append(
      el("span", "muted", "· " + formatDate(comment.created_at))
    );

    wrapper.append(
      head,
      el("div", "comment-body", comment.body)
    );

    const controls = el("div", "post-actions");
    const replyButton = el("button", "small-button", "↳ 답글");

    replyButton.type = "button";

    replyButton.addEventListener("click", () => {
      if ($(".comment-form", wrapper)) return;

      const form = el("form", "comment-form");
      const input = el("input");

      input.required = true;
      input.maxLength = 2000;
      input.placeholder = `${comment.profiles?.real_name || "친구"}에게 답글`;

      const send = el("button", "small-button", "등록");
      send.type = "submit";

      form.append(input, send);

      form.addEventListener("submit", async event => {
        event.preventDefault();

        const body = input.value.trim();
        if (!body) return;

        const { error } = await sb.from("comments").insert({
          post_id: postId,
          author_id: currentUser.id,
          parent_id: comment.id,
          body
        });

        if (error) return toast(safeError(error));

        await loadPosts();
        toast("답글을 등록했어요.");
      });

      wrapper.append(form);
      input.focus();
    });

    controls.append(replyButton);

    if (canDelete(comment.author_id)) {
      const deleteButton = el("button", "small-button danger", "삭제");
      deleteButton.type = "button";

      deleteButton.addEventListener("click", async () => {
        if (!confirm("댓글을 삭제할까요?")) return;

        const { error } = await sb
          .from("comments")
          .delete()
          .eq("id", comment.id);

        if (error) return toast(safeError(error));

        await loadPosts();
        toast("댓글을 삭제했어요.");
      });

      controls.append(deleteButton);
    }

    wrapper.append(controls);

    const replies = allComments.filter(
      item => item.parent_id === comment.id
    );

    replies.forEach(reply => {
      wrapper.append(
        renderComment(reply, allComments, postId, depth + 1)
      );
    });

    return wrapper;
  }

  // 최초 실행
  async function init() {
    if (!sb) {
      showSignedOut();
      toast("config.js에 Supabase 설정을 입력해 주세요.");
      return;
    }

    const {
      data: { session }
    } = await sb.auth.getSession();

    if (session?.user) {
      currentUser = session.user;

      try {
        await loadProfile();
      } catch (error) {
        toast(safeError(error));
      }
    } else {
      showSignedOut();
    }

    sb.auth.onAuthStateChange(async (_event, sessionNow) => {
      if (
        sessionNow?.user &&
        sessionNow.user.id !== currentUser?.id
      ) {
        currentUser = sessionNow.user;

        try {
          await loadProfile();
        } catch (error) {
          toast(safeError(error));
        }
      } else if (!sessionNow) {
        currentUser = null;
        currentProfile = null;
        currentClassroom = null;
        postsCache = [];
        showSignedOut();
      }
    });
  }

  init();
})();

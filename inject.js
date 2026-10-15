// 运行在页面自身环境（MAIN world）。
// 只“旁听”页面自己发出的评论请求的返回结果，不发出任何新请求，也不修改请求和返回内容。
(() => {
  const SOURCE = 'xhs-comment-recorder';
  const COMMENT_API = /\/api\/sns\/web\/v2\/comment\/(sub\/)?page/;

  function report(url, payload) {
    if (payload && typeof payload === 'object') {
      window.postMessage({ source: SOURCE, url: String(url), payload }, '*');
    }
  }

  // fetch
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      const promise = originalFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (COMMENT_API.test(url)) {
        promise
          .then((res) => res.clone().json())
          .then((json) => report(url, json))
          .catch(() => {});
      }
      return promise;
    };
  }

  // XMLHttpRequest
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const originalOpen = XHR.open;
    const originalSend = XHR.send;
    XHR.open = function (method, url) {
      this.__xhsRecorderUrl = String(url || '');
      return originalOpen.apply(this, arguments);
    };
    XHR.send = function () {
      const url = this.__xhsRecorderUrl;
      if (url && COMMENT_API.test(url)) {
        this.addEventListener('load', () => {
          try {
            let json = null;
            if (this.responseType === 'json') json = this.response;
            else if (this.responseType === '' || this.responseType === 'text') json = JSON.parse(this.responseText);
            report(this.responseURL || url, json);
          } catch (_) {}
        });
      }
      return originalSend.apply(this, arguments);
    };
  }
})();

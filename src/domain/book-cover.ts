// A Book's cover is put in an <img>, so only an http(s) address will do. Checked in the browser before
// a draft is sent and again when it is stored.
export const isCoverAddress = (url: string) => /^https?:\/\/\S+$/i.test(url);

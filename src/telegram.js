import createError from "http-errors";

const validate = (token) => {
  if (process.env.TG_TOKEN !== token) {
    throw createError(401);
  }
};

export const handle = (token) => {
  validate(token);
};

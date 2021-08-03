const postcss = require("postcss");
const vwRegex = require("./lib/pixel-unit-regex");
const rpxRegex = require("./lib/rpixel-unit-regex");
const filterPropList = require("./lib/filter-prop-list");
const type = require("./lib/type");

const defaults = {
  viewportWidth: 750, //px转vw时的宽度设置是多少
  rootValue: 16,
  unitPrecision: 5,
  selectorBlackList: [],
  propList: ["font", "font-size", "line-height", "letter-spacing"],
  replace: true,
  mediaQuery: false,
  minPixelValue: 0,
  exclude: null
};

const legacyOptions = {
  root_value: "rootValue",
  unit_precision: "unitPrecision",
  selector_black_list: "selectorBlackList",
  prop_white_list: "propList",
  media_query: "mediaQuery",
  propWhiteList: "propList"
};

module.exports = postcss.plugin("postcss-vwtorem", options => {
  convertLegacyOptions(options);
  const opts = Object.assign({}, defaults, options);
  const satisfyPropList = createPropListMatcher(opts.propList);

  return css => {
    const exclude = opts.exclude;
    const filePath = css.source.input.file;
    if (
      exclude &&
      ((type.isFunction(exclude) && exclude(filePath)) ||
        (type.isString(exclude) && filePath.indexOf(exclude) !== -1) ||
        filePath.match(exclude) !== null)
    ) {
      return;
    }

    const rootValue =
      typeof opts.rootValue === "function"
        ? opts.rootValue(css.source.input)
        : opts.rootValue;
    const vwReplace = createVwReplace(
      rootValue,
      opts.unitPrecision,
      opts.minPixelValue,
      opts
    );
    const rpxReplace = createRpxReplace(
      rootValue,
      opts.unitPrecision,
      opts.minPixelValue
    );

    css.walkDecls((decl, i) => {
      if (
        (decl.value.indexOf("vw") === -1 && decl.value.indexOf("rpx") === -1) ||
        !satisfyPropList(decl.prop) ||
        blacklistedSelector(opts.selectorBlackList, decl.parent.selector)
      )
        return;

      let value = "";
      if (decl.value.indexOf("vw") !== -1) {
        value = decl.value.replace(vwRegex, vwReplace);
      } else {
        value = decl.value.replace(rpxRegex, rpxReplace);
      }

      // if rem unit already exists, do not add or replace
      if (declarationExists(decl.parent, decl.prop, value)) return;

      if (opts.replace) {
        decl.value = value;
      } else {
        decl.parent.insertAfter(i, decl.clone({ value: value }));
      }
    });

    if (opts.mediaQuery) {
      css.walkAtRules("media", rule => {
        if (
          rule.params.indexOf("vw") === -1 &&
          rule.params.indexOf("rpx") === -1
        )
          return;
        if (rule.params.indexOf("vw") !== -1) {
          rule.params = rule.params.replace(vwRegex, vwReplace);
        } else {
          rule.params = rule.params.replace(rpxRegex, rpxReplace);
        }
      });
    }
  };
});

function convertLegacyOptions(options) {
  if (typeof options !== "object") return;
  if (
    ((typeof options["prop_white_list"] !== "undefined" &&
      options["prop_white_list"].length === 0) ||
      (typeof options.propWhiteList !== "undefined" &&
        options.propWhiteList.length === 0)) &&
    typeof options.propList === "undefined"
  ) {
    options.propList = ["*"];
    delete options["prop_white_list"];
    delete options.propWhiteList;
  }
  Object.keys(legacyOptions).forEach(key => {
    if (Reflect.has(options, key)) {
      options[legacyOptions[key]] = options[key];
      delete options[key];
    }
  });
}

function createVwReplace(rootValue, unitPrecision, minPixelValue, opts) {
  return (m, $1) => {
    if (!$1) return m;
    const { viewportWidth } = opts; // 转成vw时px的屏幕宽度
    const viewportVal = parseFloat($1);
    const pixels = (viewportVal / 100) * viewportWidth; // 先转成px
    if (pixels < minPixelValue) return m;
    const fixedVal = toFixed(pixels / rootValue, unitPrecision);
    return fixedVal === 0 ? "0" : fixedVal + "rem";
  };
}
function createRpxReplace(rootValue, unitPrecision, minPixelValue) {
  return (m, $1) => {
    if (!$1) return m;
    const pixels = parseFloat($1);
    if (pixels < minPixelValue) return m;
    const fixedVal = toFixed(pixels / rootValue, unitPrecision);
    return fixedVal === 0 ? "0" : fixedVal + "rem";
  };
}

function toFixed(number, precision) {
  const multiplier = Math.pow(10, precision + 1),
    wholeNumber = Math.floor(number * multiplier);
  return (Math.round(wholeNumber / 10) * 10) / multiplier;
}

function declarationExists(decls, prop, value) {
  return decls.some(decl => decl.prop === prop && decl.value === value);
}

function blacklistedSelector(blacklist, selector) {
  if (typeof selector !== "string") return;
  return blacklist.some(regex => {
    if (typeof regex === "string") {
      return selector.indexOf(regex) !== -1;
    }
    return selector.match(regex);
  });
}

function createPropListMatcher(propList) {
  const hasWild = propList.indexOf("*") > -1;
  const matchAll = hasWild && propList.length === 1;
  const lists = {
    exact: filterPropList.exact(propList),
    contain: filterPropList.contain(propList),
    startWith: filterPropList.startWith(propList),
    endWith: filterPropList.endWith(propList),
    notExact: filterPropList.notExact(propList),
    notContain: filterPropList.notContain(propList),
    notStartWith: filterPropList.notStartWith(propList),
    notEndWith: filterPropList.notEndWith(propList)
  };
  return prop => {
    if (matchAll) return true;
    return (
      (hasWild ||
        lists.exact.indexOf(prop) > -1 ||
        lists.contain.some(function(m) {
          return prop.indexOf(m) > -1;
        }) ||
        lists.startWith.some(function(m) {
          return prop.indexOf(m) === 0;
        }) ||
        lists.endWith.some(function(m) {
          return prop.indexOf(m) === prop.length - m.length;
        })) &&
      !(
        lists.notExact.indexOf(prop) > -1 ||
        lists.notContain.some(function(m) {
          return prop.indexOf(m) > -1;
        }) ||
        lists.notStartWith.some(function(m) {
          return prop.indexOf(m) === 0;
        }) ||
        lists.notEndWith.some(function(m) {
          return prop.indexOf(m) === prop.length - m.length;
        })
      )
    );
  };
}

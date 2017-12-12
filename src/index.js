/**
 * @file 又拍云图片处理工具插件
 * @author lisfan <goolisfan@gmail.com>
 * @version 2.0.0
 * @licence MIT
 */

import validation from '@~lisfan/validation'
import Logger from '@~lisfan/logger'

import getNetworkType from './utils/get-network-type'
import isWebp from './utils/webp-features-support'

let UPYunImageFormat = {} // 插件对象
const PLUGIN_TYPE = 'filter' // 插件类型
const FILTER_NAMESPACE = 'image-format' // 过滤器名称

/**
 * 又拍云缩放方式，各种缩放规则所需要的尺寸参数长度
 *
 * @ignore
 * @enum {number}
 */
const SCALE_PARAM_LEN = {
  fw: 1,
  fh: 1,
  max: 1,
  min: 1,
  fwfh: 2,
  fwfh2: 2,
  both: 2,
  sq: 1,
  scale: 1,
  wscale: 1,
  hscale: 1,
  fxfn: 2,
  fxfn2: 2,
  fp: 1,
}

const FORMAT_RULES = {
  compress: /jpg|jpeg|png/,
  format: /jpg|jpeg|png|webp/,
  progressive: /jpg|jpeg/,
  quality: /jpg|jpeg/,
  lossless: /webp/,
}

// 私有方法
const _actions = {
  /**
   * 获取图片后缀
   * 【注】假设图片文件末尾都是以存在后缀的，未兼容处理那些不带后缀形式的图片文件
   *
   * @since 2.0.0
   * @param {string} filename - 文件名称
   * @returns {string}
   */
  getFileExtension(filename) {
    const extReg = /\.([^.]*)$/
    const matched = filename.match(extReg)

    if (!matched) {
      return ''
    }

    return matched[1]
  },
  /**
   * 根据当前的网络制式，获取最终的DPR值
   *
   * @since 2.0.0
   * @param {string} networkType - 网络制式类型
   * @param {number} DPR - 设备像素比
   * @param {number} maxDPR - 支持的最大设备像素比
   * @returns {number}
   */
  getFinalDPR(networkType, DPR, maxDPR) {
    if (networkType === '4g' || networkType === 'unknow') {
      return DPR >= maxDPR ? maxDPR : DPR
    } else if (networkType === 'wifi') {
      return DPR
    } else {
      return 1
    }
  },
  /**
   * 获取最终的图片尺寸
   *
   * @since 2.0.0
   * @param {?number|string} size - 自定义尺寸
   * @param {string} finalScale - 最终缩放格式
   * @param {number} finalDPR - 最终DPR值
   * @param {number} draftRatio - 物理尺寸和UI草稿比
   * @returns {?string}
   */
  getFinalSize(size, finalScale, finalDPR, draftRatio) {
    // 是否存在有效的尺寸值
    let isValidSize = false

    let finalSizeList = []

    if (!validation.isNil(size)) {
      const sizeList = size.toString().split('x')

      finalSizeList = sizeList.map((sizeItem) => {
        return Math.round((Number.parseFloat(sizeItem) / draftRatio) * finalDPR)
      })

      // 查看是否为数字格式
      finalSizeList = finalSizeList.filter((size) => {
        return validation.isNumber(size)
      })

      const paramLen = SCALE_PARAM_LEN[finalScale]
      // 截取缩放方式需要的缩放规格长度
      finalSizeList = finalSizeList.slice(0, paramLen)
      const sizeLen = finalSizeList.length
      isValidSize = sizeLen > 0

      if (paramLen > sizeLen) {
        const quotient = Math.ceil(sizeLen / paramLen) + 1

        finalSizeList = (finalSizeList.toString() + ',').repeat(quotient).slice(0, -1).split(',')
        finalSizeList = finalSizeList.slice(0, paramLen)
      }
    }

    return isValidSize ? finalSizeList.join('x') : null
  },
  /**
   * 根据条件确定默认输出图片格式
   *
   * - 根据浏览器对webp的支持力度及其他一些情况，用户上传的图片如果是非webp格式或jpg格式，如源图是png的，则会按照以下不同的场景转换成webp或jpg
   * - (静态，支持有损webp，图片宽小于设备物理分辨率*dpr的2分之1时或小于200px*dpr时)，使用webp格式（又拍云api: `/format/webp`）
   *  - (静态，支持有损webp，图片宽大于设备物理分辨率*dpr的2分之1时且大于200px*dpr时)，使用jpg格式（又拍云api: `/format/jpg`）
   *  - (静态，不支持webp)，使用jpg格式（又拍云api: `/format/jpg`）
   *  - (动态，支持动态webp时)，使用webp格式（又拍云api: `/format/webp`）
   *  - (动态，不支持动态webp时)，使用gif格式，不作变动
   *
   * @since 2.0.0
   * @param {string} originFormat - 原格式
   * @param {number} width - 用户自定义的宽度
   * @param {number} minWidth - 最小宽度
   * @returns {string}
   */
  computeDefaultFormat(originFormat, width, minWidth) {
    // 如果源文件是动态图片且支持动态webp时，则转换为webp
    if (originFormat === 'gif') {
      return isWebp.support('animation') ? 'webp' : 'gif'
    } else {
      // 如果支持静态webp
      return isWebp.support('lossy') && width >= 0 && minWidth >= width ? 'webp' : 'jpg'
    }
  },
  /**
   * 根据条件，获取最终的图片格式
   *
   * @since 2.0.0
   * @param {string} format - 自定义格式
   * @param {string} originFormat - 原格式
   * @param {?number} width - 自定义尺寸
   * @param {number} minWidth - 最小尺寸
   * @param {boolean} [lossless] - 是否转换为无损webp格式
   * @returns {string}
   */
  getFinalFormat(format, originFormat, width, minWidth, lossless) {
    // 若未自定义图片格式，则根据一些条件，设置默认格式
    // 若自定义了图片格式，且不是指定为webp格式，则直接返回指定的格式
    // 若指定为webp格式
    //   - 若源图片gif格式，则检测是否支持动态webp格式，
    //   - 若源图片jpg或png格式，则检测是否支持有损webp格式或无损webp格式
    // 如果指定了自定义值，则使用自定义值
    if (!validation.isString(format)) {
      return _actions.computeDefaultFormat(originFormat, width, minWidth)
    }

    if (format === 'webp') {
      // 若源图片gif格式，则检测是否支持动态webp格式，若不支持则转换为gif格式
      //   - 若源图片jpg或png格式，则检测是否支持有损webp格式或无损webp格式
      if (originFormat === 'gif' && !isWebp.support('animation')) {
        return 'gif'
      } else if (originFormat.match(/jpeg|jpg|png/) && !lossless && !isWebp.support('lossy')) {
        return 'jpg'
      } else if (originFormat.match(/jpeg|jpg|png/) && lossless && !isWebp.support('lossless')) {
        return 'jpg'
      } else {
        return 'webp'
      }
    }

    // 返回源格式
    return format
  },
  /**
   * 获取自定义的其他又拍云规则项
   * [注] 规则项需要有对应关系，不可随意填写
   *
   * @since 2.0.0
   * @param {object} otherRules- 其他又拍云规则项
   * @returns {object}
   */
  getFinalOtherRules(otherRules) {
    if (validation.isEmpty(otherRules)) {
      return {}
    }

    // 如果本身已是对象格式，则直接返回
    if (validation.isPlainObject(otherRules)) {
      return otherRules
    }

    otherRules = otherRules.startsWith('/') ? otherRules.slice(1) : otherRules

    const rules = otherRules.split('/')

    // 分割后的的数据长度能被2整除，无余数
    if (rules.length % 2 !== 0) {
      throw new Error('other rules is\'t parse! please check')
    }

    const finalOtherRules = {}

    rules.forEach((value, index) => {
      if (index % 2 === 0) {
        finalOtherRules[value] = rules[index + 1]
      }
    })

    return finalOtherRules
  },
  /**
   * 过滤为undefined、null及空值
   *
   * @since 2.0.0
   * @param {object} rules - 规则配置
   * @returns {object}
   */
  filterRules(rules) {
    let filterRules = {}
    Object.entries(rules).forEach(([key, value]) => {
      if (!validation.isNil(value) || !validation.isEmpty(value)) {
        filterRules[key] = value
      }
    })

    return filterRules
  },
  /**
   * 根据图片格式进一步优化规则
   * 目前只有两条规则，所以不采用策略，直接进行逻辑判断
   *
   * @since 2.0.0
   * @param {object} rules - 优化规则
   * @returns {object}
   */
  optimizeRules(rules) {
    // 若未jpg格式，且不存在渐进加载的配置时，
    if (!validation.isBoolean(rules.progressive) && rules.format === 'jpg') {
      rules.progressive = true
    } else if (!validation.isBoolean(rules.compress) && rules.format === 'png') {
      rules.compress = true
    }

    return rules
  },
  /**
   * 针对图片格式，过滤规则
   *
   * 移除某些针对与具体格式或者属性时的规则
   * - 如compress只能用在jpg和png上
   * - 如format不支持值是gif
   * - 如progressive只支持jpg
   * - 如quality只支持jpg
   * - 如lossless只支持webp
   *
   * @since 2.0.2
   * @param {object} rules - 规则配置
   * @returns {object}
   */
  filterRulesByFormat(rules) {
    const format = rules.format
    // 未匹配到时进行过滤
    Object.entries(FORMAT_RULES).forEach(([key, regexp]) => {
      const matched = format.match(regexp)

      if (!matched) {
        rules[key] = null
      }
    })

    return rules
  },
  /**
   * 序列化规则为符合格式的字符串
   *
   * @since 2.0.0
   * @param {object} rules - 规则配置
   * @returns {string}
   */
  stringifyRule(rules) {
    const matchedRules = _actions.filterRulesByFormat(rules)
    let filterRules = _actions.filterRules(matchedRules)

    // 处理针对格式的优化
    filterRules = _actions.optimizeRules(filterRules)

    // 不存在值时，直接返回空字符串
    if (Object.keys(filterRules).length === 0) {
      return ''
    }

    // 提前取出缩放方式(scale)和尺寸(size)进行额外的处理，其他值做拼接
    let imageSrc = validation.isNil(filterRules.size) ? '' : `/${filterRules.scale}/${filterRules.size}`

    // 规则按key名进行排序：解决相同的优化字段时，因key的顺序不同而造成再次进行图片处理
    const sortedRules = Object.entries(filterRules).sort(([prevKey], [nextKey]) => {
      return prevKey > nextKey
    })

    imageSrc += sortedRules.reduce((result, [key, value]) => {
      if (key === 'size' || key === 'scale') {
        return result
      }

      return result + `/${key}/${value}`
    }, '')

    // 规则至少存在一项时，则加上前缀`!`修饰符号
    return validation.isEmpty(imageSrc) ? '' : '!' + imageSrc
  }
}

/**
 * 又拍云图片处理工具注册函数
 * 处理规则请参考[又拍云文档](http://docs.upyun.com/cloud/image/#webp)
 *
 * 若想针对某个值使用默认值，则传入null值即可
 *
 * @global
 * @since 2.0.0
 * @param {Vue} Vue - Vue类
 * @param {object} [options={}] - 配置选项
 * @param {boolean} [options.debug=false] - 是否开启日志调试模式
 * @param {number} [options.maxDPR=3] - (>=4)g网络或者'unknow'未知网络下，DPR取值的最大数
 * @param {number} [options.draftRatio=2] - UI设计稿尺寸与设备物理尺寸的比例
 * @param {string} [options.scale='both'] - 又拍云图片尺寸缩放方式，默认宽度进行自适应，超出尺寸进行裁剪，若自定义尺寸大于原尺寸时，自动缩放至指定尺寸再裁剪
 * @param {number} [options.quality=90] - 又拍云jpg格式图片压缩质量
 * @param {string} [options.rules=''] - 又拍云图片处理的其他规则
 * @param {number} [options.minWidth] - 默认值是(当前设备的物理分辨率 * 当前实际设备像素比的) 二分之一
 * @param {function} [options.networkHandler='unknow'] - 获取网络制式的处理函数，若不存在，返回unknow
 */
UPYunImageFormat.install = async function (Vue, {
  debug = false,
  maxDPR = 3,
  draftRatio = 2,
  scale = 'both',
  quality = 90,
  rules = '',
  minWidth = global.document.documentElement.clientWidth * global.devicePixelRatio / 2,
  networkHandler = getNetworkType
} = {}) {
  const logger = new Logger({
    name: `${PLUGIN_TYPE}:${FILTER_NAMESPACE}`,
    debug
  })

  // 插件注册时验证是否会存在网络制式处理器，若不存在，则抛出错误
  if (!validation.isFunction(networkHandler)) {
    logger.error(`Vue plugin install faild! require a (networkHandler) option property, type is (function), please check!`)
  }

  /**
   * vue过滤器：image-format
   *
   * @global
   * @function image-format
   * @since 2.0.0
   * @param {string} src - 图片地址，第一个参数vue组件会自动传入，无须管理
   * @param {?number|string|object} [sizeOrConfig] - 裁剪尺寸，取设计稿中的尺寸即可，该值如果是一个字典格式的配置对象，则会其他参数选项的值
   * @param {?string} [scale='both'] - 缩放方式
   * @param {?string} [format] - 图片格式化，系统会根据多种情况来最终确定该值的默认值
   * @param {?number} [quality=90] - 若输出jpg格式图片时的压缩质量
   * @param {?string|object} [rules=''] -
   *   又拍云图片处理的的其他规则，注意，如果它是一个字符串格式是，那么它必须是采用`/[key]/[value]`这样的写法，不能随意乱写，同时这里的值不会覆盖前几个参数的值，该项的优先级最低
   */
  Vue.filter(FILTER_NAMESPACE, (src, sizeOrConfig, customScale = scale, customformat, customQuality = quality, customOtherRules = rules) => {
    // 如果未传入图片地址，则直接返回空值
    if (validation.isUndefined(src) || validation.isEmpty(src)) {
      return ''
    }

    const DPR = global.devicePixelRatio || 1 // 当前设备的DPR值
    const networkType = networkHandler() || 'unknow' // 当前网络制式，每次重新获取，因网络随时会变化

    // 如果size是一个对象，则表示是以字典的方式进行配置参数
    let originSize, originScale, originFormat, originQuality, originOtherRules

    if (validation.isPlainObject(sizeOrConfig)) {
      const { size: sizeOption, scale: scaleOption, format: formatOption, quality: qualityOption, ...otherRulesOption } = sizeOrConfig

      originSize = sizeOption
      originScale = scaleOption
      originFormat = formatOption
      originQuality = qualityOption
      originOtherRules = otherRulesOption
    } else {
      originSize = sizeOrConfig
      originScale = customScale
      originFormat = customformat
      originQuality = customQuality
      originOtherRules = customOtherRules
    }

    logger.log('network:', networkType)
    logger.log('origin image src:', src)
    logger.log('origin image size:', originSize)
    logger.log('origin image format:', originFormat)
    logger.log('origin image scale:', originScale)
    logger.log('origin image quality:', originQuality)
    logger.log('origin rules:', originOtherRules)

    // 最终的其他规则
    let finalRules = _actions.getFinalOtherRules(originOtherRules)
    // 最终的DPR
    let finalDPR = _actions.getFinalDPR(networkType, DPR, maxDPR)
    // 最终的缩放取值
    let finalScale = originScale || scale
    // 最终的质量取值
    let finalQuality = originQuality || quality
    // 最终的图片尺寸
    let finalSize = _actions.getFinalSize(originSize, finalScale, finalDPR, draftRatio)

    // 获取图片宽度
    let width
    if (validation.isString(finalSize)) {
      width = finalSize.split('x')[0]
    }

    // 最终的图片格式
    let finalFormat = _actions.getFinalFormat(originFormat, _actions.getFileExtension(src), width, minWidth, finalRules.lossless)

    logger.log('final image size:', finalSize)
    logger.log('final image DPR:', finalDPR)
    logger.log('final image scale:', finalScale)
    logger.log('final image quality:', finalQuality)
    logger.log('final image format:', finalFormat)
    logger.log('final image custom rules:', finalRules)

    // 序列化规则
    const stringifyRule = _actions.stringifyRule({
      ...finalRules,
      format: finalFormat,
      scale: finalScale, // 缩放规格
      size: finalSize, // 图片尺寸
      quality: finalQuality, // jpg图片压缩质量
    })

    logger.log('final image rule:', stringifyRule)

    // 拼接最终的结果
    let finalSrc = src + stringifyRule

    logger.log('final image src:', finalSrc)

    return finalSrc
  })
}

export default UPYunImageFormat

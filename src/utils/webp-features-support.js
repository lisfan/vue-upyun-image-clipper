/**
 * @file 检测webp特性的支持程度
 */

import validation from '@~lisfan/validation'
import Logger from '@~lisfan/logger'

const logger = new Logger('webp-features')

// 将检测结果存储在sessionStorage中，期间只检测一次，避免重复求值
const storageName = 'WEBP_FEATURES'

const WEBP_FEATURES = JSON.parse(global.sessionStorage.getItem(storageName)) || {
  lossy: undefined,
  lossless: undefined,
  animation: undefined
}

const IMAGES_SOURCE = {
  // 有损图片
  lossy: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  // 无损图片
  lossless: "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  // 支持alpha通道图片
  // alpha:
  // "data:image/webp;base64,UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggGAAAABQBAJ0BKgEAAQAAAP4AAA3AAP7mtQAAAA==",
  // 动态webp图片
  animation: "data:image/webp;base64,UklGRlIAAABXRUJQVlA4WAoAAAASAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GJgAAAAAAAAAAAAAAAAAAAGQAAABWUDhMDQAAAC8AAAAQBxAREYiI/gcA"
}

/**
 * 检测webp特性的支持程度
 * @param {string} feature - 特性值
 * @returns {Promise}
 */
function checkWebpFeatures(feature) {
  return new Promise((resolve, reject) => {
    let $image = new Image()

    $image.onload = function () {
      ($image.width > 0) && ($image.height > 0) ? resolve(true) : reject(false)
    }

    $image.onerror = function () {
      reject(false)
    }

    $image.src = IMAGES_SOURCE[feature]
  })
}

// 发起检测
Object.entries(WEBP_FEATURES).forEach(([feature, isSupport]) => {
  // 如果已经从缓存中先进知了支持结果，则不再处理
  if (validation.isBoolean(isSupport)) {
    logger.log('sessionStorage already existed test result:', feature, isSupport)

    return
  }

  logger.log(`checking webp ${feature} feature`)

  checkWebpFeatures(feature).then(() => {
    WEBP_FEATURES[feature] = true
    logger.log(`so lucky! support ${feature} feature`)
  }).catch(() => {
    WEBP_FEATURES[feature] = false
    logger.log(`sorry! unsupport ${feature} feature`)
  }).finally(() => {
    // 存储检测成功后的结果
    global.sessionStorage.setItem(storageName, JSON.stringify(WEBP_FEATURES))
  })
})

export default {
  /**
   * 是否支持对应的webp特性
   *
   * @param {string} feature - 特性值
   * @returns {boolean}
   */
  support(feature) {
    return WEBP_FEATURES[feature]
  }
}


